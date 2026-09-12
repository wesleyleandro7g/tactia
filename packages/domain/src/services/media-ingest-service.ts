import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  DataSourceRepository,
  InteractionRepository,
  MediaAssetPurpose,
  MediaAssetRepository,
  RawRecordRepository,
} from '@tactia/database';
import {
  ALLOWED_AUDIO_MIME,
  ALLOWED_IMAGE_MIME,
  AUDIO_MAX_BYTES,
  AppError,
  ErrorCode,
  IMAGE_MAX_BYTES,
  createId,
  extFromFileName,
  logger,
  paginationArgs,
  storageKey,
  type ObjectStorage,
  type RequestContext,
} from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import {
  STT_UNAVAILABLE,
  VISION_UNAVAILABLE,
  type AudioTranscriber,
  type VisionExtractor,
} from '../ports/media';
import type { KnowledgeDocumentService } from './knowledge-document-service';
import type { InteractionEnrichmentService } from './interaction-enrichment-service';

const purposeSchema = z.enum(['knowledge', 'interaction', 'auto']);
const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type IngestMediaJob = { tenantId: string; mediaId: string };

export type MediaIngestServiceDeps = {
  media: MediaAssetRepository;
  storage: ObjectStorage;
  dataSources: DataSourceRepository;
  rawRecords: RawRecordRepository;
  interactions: InteractionRepository;
  documents: KnowledgeDocumentService;
  vision?: VisionExtractor | null;
  transcriber?: AudioTranscriber | null;
  enrichment?: InteractionEnrichmentService;
  enqueueIngest?: (job: IngestMediaJob) => Promise<void>;
};

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isImage(mime: string): boolean {
  return (ALLOWED_IMAGE_MIME as readonly string[]).includes(mime);
}

function isAudio(mime: string): boolean {
  return (ALLOWED_AUDIO_MIME as readonly string[]).includes(mime);
}

function mimeFromFile(file: { name: string; type?: string }): string {
  const type = (file.type ?? '').toLowerCase();
  if (isImage(type) || isAudio(type)) return type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.wav')) return 'audio/wav';
  if (name.endsWith('.webm')) return 'audio/webm';
  if (name.endsWith('.ogg')) return 'audio/ogg';
  return type;
}

export class MediaIngestService {
  constructor(private readonly deps: MediaIngestServiceDeps) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listQuery.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.deps.media.list({ tenantId: ctx.tenantId, skip, take });
    return { ...result, pagination: { page: parsed.page, pageSize: parsed.pageSize } };
  }

  async listPendingMapping(ctx: RequestContext) {
    assertTenantContext(ctx);
    const items = await this.deps.rawRecords.listVisionPending({ tenantId: ctx.tenantId });
    return {
      items: items.map((item) => ({
        id: item.id,
        entityType: item.entityType,
        payload: item.payload,
        createdAt: item.createdAt,
        hint: 'Extraímos os campos. Importe como venda/despesa no onboarding para entrar nas métricas.',
      })),
    };
  }

  async createFromUpload(
    ctx: RequestContext,
    input: {
      purpose?: string;
      file: { name: string; type?: string; arrayBuffer: () => Promise<ArrayBuffer> };
    },
  ) {
    assertRole(ctx, 'member');
    const mime = mimeFromFile(input.file);
    const kind = isImage(mime) ? 'image' : isAudio(mime) ? 'audio' : null;
    if (!kind) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Envie uma imagem (JPEG/PNG/WebP) ou áudio (MP3/WAV/WebM/OGG).');
    }
    const bytes = Buffer.from(await input.file.arrayBuffer());
    if (bytes.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Arquivo vazio.');
    }
    const max = kind === 'audio' ? AUDIO_MAX_BYTES : IMAGE_MAX_BYTES;
    if (bytes.length > max) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        kind === 'audio' ? 'O áudio pode ter no máximo 25 MB.' : 'A imagem pode ter no máximo 10 MB.',
      );
    }

    const purpose = purposeSchema.catch('auto').parse(input.purpose ?? 'auto') as MediaAssetPurpose;
    const id = createId();
    const key = storageKey({
      tenantId: ctx.tenantId,
      kind,
      id,
      ext: extFromFileName(input.file.name),
    });
    await this.deps.storage.put({ key, body: bytes, contentType: mime });

    const asset = await this.deps.media.create({
      id,
      tenantId: ctx.tenantId,
      purpose,
      mime,
      storageKey: key,
      checksum: sha256(bytes),
      byteSize: bytes.length,
      uploadedBy: ctx.userId,
    });

    await this.enqueueOrRun({ tenantId: ctx.tenantId, mediaId: asset.id });
    const fresh = await this.deps.media.findById({ tenantId: ctx.tenantId, id: asset.id });
    return fresh ?? asset;
  }

  async ingest(job: IngestMediaJob): Promise<void> {
    const asset = await this.deps.media.findById({ tenantId: job.tenantId, id: job.mediaId });
    if (!asset) return;

    await this.deps.media.update({
      tenantId: job.tenantId,
      id: job.mediaId,
      data: { status: 'processing', error: null },
    });

    try {
      const object = await this.deps.storage.get(asset.storageKey);
      if (isAudio(asset.mime)) {
        await this.ingestAudio(job.tenantId, asset.id, object.body, object.contentType, asset.storageKey);
        return;
      }
      await this.ingestImage(job.tenantId, asset);
    } catch (error) {
      logger.warn(
        {
          tenant_id: job.tenantId,
          operation: 'media_ingest',
          media_id: job.mediaId,
          err: error instanceof Error ? error.message : String(error),
        },
        'media ingest failed',
      );
      await this.deps.media.update({
        tenantId: job.tenantId,
        id: job.mediaId,
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'INGEST_FAILED',
        },
      });
    }
  }

  private async ingestImage(
    tenantId: string,
    asset: { id: string; purpose: MediaAssetPurpose; mime: string; storageKey: string },
  ) {
    if (!this.deps.vision) {
      await this.deps.media.update({
        tenantId,
        id: asset.id,
        data: { status: 'failed', error: VISION_UNAVAILABLE },
      });
      return;
    }

    const object = await this.deps.storage.get(asset.storageKey);
    const extracted = await this.deps.vision.extract({ bytes: object.body, mime: asset.mime });
    const classification = extracted.classification;
    const actor = { tenantId, userId: null as string | null };

    if (asset.purpose === 'knowledge' || classification === 'policy') {
      const document = await this.deps.documents.createFromText(actor, {
        title: 'Documento extraído de imagem',
        kind: 'policy',
        text: extracted.text,
      });
      await this.deps.media.update({
        tenantId,
        id: asset.id,
        data: {
          status: 'ready',
          classification,
          resultKind: 'document',
          resultId: document.id,
          error: null,
        },
      });
      return;
    }

    if (classification === 'invoice' || classification === 'receipt') {
      const entityType = classification === 'invoice' ? 'sale' : 'expense';
      const source = await this.deps.dataSources.findOrCreateSystem({
        tenantId,
        type: 'image',
        name: 'Visão (imagens)',
      });
      const checksum = sha256Buffer(Buffer.from(JSON.stringify({ source: 'vision', assetId: asset.id })));
      const { record } = await this.deps.rawRecords.upsertByKey({
        tenantId,
        dataSourceId: source.id,
        externalId: asset.id,
        entityType,
        checksum,
        payload: {
          source: 'vision',
          fields: extracted.fields ?? {},
          text: extracted.text,
          classification,
          mediaId: asset.id,
        },
      });
      await this.deps.media.update({
        tenantId,
        id: asset.id,
        data: {
          status: 'ready',
          classification,
          resultKind: 'raw_record',
          resultId: record.id,
          error: null,
        },
      });
      return;
    }

    if (classification === 'conversation_screenshot' || (classification === 'other' && extracted.text.trim().length > 40)) {
      const interaction = await this.deps.interactions.create({
        tenantId,
        channel: 'other',
        body: extracted.text,
        occurredAt: new Date(),
        metadata: { source: 'vision', storageKey: asset.storageKey, mediaId: asset.id },
      });
      if (this.deps.enrichment) {
        await this.deps.enrichment.enrichPending({ tenantId });
      }
      await this.deps.media.update({
        tenantId,
        id: asset.id,
        data: {
          status: 'ready',
          classification,
          resultKind: 'interaction',
          resultId: interaction.id,
          error: null,
        },
      });
      return;
    }

    const document = await this.deps.documents.createFromText(actor, {
      title: 'Documento extraído de imagem',
      kind: 'policy',
      text: extracted.text,
    });
    await this.deps.media.update({
      tenantId,
      id: asset.id,
      data: {
        status: 'ready',
        classification,
        resultKind: 'document',
        resultId: document.id,
        error: null,
      },
    });
  }

  private async ingestAudio(
    tenantId: string,
    mediaId: string,
    bytes: Buffer,
    mime: string,
    storageKeyValue: string,
  ) {
    if (!this.deps.transcriber) {
      await this.deps.media.update({
        tenantId,
        id: mediaId,
        data: { status: 'failed', error: STT_UNAVAILABLE },
      });
      return;
    }
    const transcribed = await this.deps.transcriber.transcribe({ bytes, mime });
    const interaction = await this.deps.interactions.create({
      tenantId,
      channel: 'note',
      body: transcribed.text,
      occurredAt: new Date(),
      metadata: { source: 'audio', storageKey: storageKeyValue, mediaId, language: transcribed.language },
    });
    if (this.deps.enrichment) {
      await this.deps.enrichment.enrichPending({ tenantId });
    }
    await this.deps.media.update({
      tenantId,
      id: mediaId,
      data: {
        status: 'ready',
        classification: 'audio',
        resultKind: 'interaction',
        resultId: interaction.id,
        error: null,
      },
    });
  }

  private async enqueueOrRun(job: IngestMediaJob) {
    if (this.deps.enqueueIngest) {
      await this.deps.enqueueIngest(job);
      return;
    }
    await this.ingest(job);
  }
}

function sha256Buffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
