import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  CHUNK_SEARCH_LIMIT,
  EMBED_PENDING_BATCH,
  type KnowledgeDocumentKind,
  type KnowledgeDocumentRepository,
} from '@tactia/database';
import {
  ALLOWED_DOC_MIME,
  AppError,
  DOCUMENT_MAX_BYTES,
  ErrorCode,
  createId,
  extFromFileName,
  logger,
  paginationArgs,
  storageKey,
  type ObjectStorage,
  type RequestContext,
} from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import type { TextEmbedder } from '../ports/embedder';
import {
  PDF_NO_TEXT,
  Utf8AndPdfExtractor,
  type DocumentTextExtractor,
} from '../ports/document-extractor';
import { chunkText } from './chunker';
import { AuditAction, type AuditLogService } from './audit-log-service';

export const knowledgeDocumentKindSchema = z.enum(['policy', 'playbook_doc', 'contract', 'other']);

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(['pending', 'processing', 'ready', 'failed']).optional(),
});

export type IngestDocumentJob = { tenantId: string; documentId: string };

export type KnowledgeDocumentServiceDeps = {
  documents: KnowledgeDocumentRepository;
  storage: ObjectStorage;
  auditLogs: AuditLogService;
  embedder?: TextEmbedder | null;
  extractor?: DocumentTextExtractor;
  enqueueIngest?: (job: IngestDocumentJob) => Promise<void>;
};

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function mimeFromFile(file: { name: string; type?: string }): string {
  const type = (file.type ?? '').toLowerCase();
  if ((ALLOWED_DOC_MIME as readonly string[]).includes(type)) return type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'text/markdown';
  if (name.endsWith('.txt')) return 'text/plain';
  return type;
}

export class KnowledgeDocumentService {
  private readonly extractor: DocumentTextExtractor;

  constructor(private readonly deps: KnowledgeDocumentServiceDeps) {
    this.extractor = deps.extractor ?? new Utf8AndPdfExtractor();
  }

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listQuery.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.deps.documents.list({
      tenantId: ctx.tenantId,
      skip,
      take,
      status: parsed.status,
    });
    return { ...result, pagination: { page: parsed.page, pageSize: parsed.pageSize } };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const document = await this.deps.documents.findById({ tenantId: ctx.tenantId, id });
    if (!document) throw new AppError(ErrorCode.NOT_FOUND, 'Document not found');
    return document;
  }

  async createFromUpload(
    ctx: RequestContext,
    input: { title?: string; kind?: string; file: { name: string; type?: string; arrayBuffer: () => Promise<ArrayBuffer> } },
  ) {
    assertRole(ctx, 'member');
    const mime = mimeFromFile(input.file);
    if (!(ALLOWED_DOC_MIME as readonly string[]).includes(mime)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Envie um PDF, TXT ou Markdown.');
    }
    const bytes = Buffer.from(await input.file.arrayBuffer());
    if (bytes.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Arquivo vazio.');
    }
    if (bytes.length > DOCUMENT_MAX_BYTES) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'O arquivo pode ter no máximo 20 MB.');
    }

    const checksum = sha256(bytes);
    const existing = await this.deps.documents.findByChecksum({
      tenantId: ctx.tenantId,
      checksum,
    });
    if (existing) {
      return { document: existing, reused: true as const };
    }

    const kind = knowledgeDocumentKindSchema.catch('other').parse(input.kind ?? 'other');
    const id = createId();
    const ext = extFromFileName(input.file.name);
    const key = storageKey({ tenantId: ctx.tenantId, kind: 'document', id, ext });
    await this.deps.storage.put({ key, body: bytes, contentType: mime });

    const title = (input.title ?? input.file.name.replace(/\.[^.]+$/, '')).trim() || 'Documento';
    const document = await this.deps.documents.create({
      id,
      tenantId: ctx.tenantId,
      title,
      kind: kind as KnowledgeDocumentKind,
      mime,
      storageKey: key,
      checksum,
      byteSize: bytes.length,
      uploadedBy: ctx.userId,
    });

    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.DOCUMENT_UPLOADED,
      entityType: 'knowledge_document',
      entityId: document.id,
      metadata: { title: document.title, mime, byteSize: document.byteSize },
    });

    await this.enqueueOrRun({ tenantId: ctx.tenantId, documentId: document.id });
    const fresh = await this.deps.documents.findById({ tenantId: ctx.tenantId, id: document.id });
    return { document: fresh ?? document, reused: false as const };
  }

  async createFromText(
    ctx: { tenantId: string; userId?: string | null },
    input: { title: string; kind: KnowledgeDocumentKind; text: string; mime?: string },
  ) {
    if (!ctx.tenantId) throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
    const bytes = Buffer.from(input.text, 'utf8');
    const checksum = sha256(bytes);
    const existing = await this.deps.documents.findByChecksum({
      tenantId: ctx.tenantId,
      checksum,
    });
    if (existing) return existing;

    const id = createId();
    const key = storageKey({ tenantId: ctx.tenantId, kind: 'document', id, ext: 'txt' });
    await this.deps.storage.put({ key, body: bytes, contentType: input.mime ?? 'text/plain' });
    const document = await this.deps.documents.create({
      id,
      tenantId: ctx.tenantId,
      title: input.title,
      kind: input.kind,
      mime: input.mime ?? 'text/plain',
      storageKey: key,
      checksum,
      byteSize: bytes.length,
      uploadedBy: ctx.userId,
    });
    await this.enqueueOrRun({ tenantId: ctx.tenantId, documentId: document.id });
    return (await this.deps.documents.findById({ tenantId: ctx.tenantId, id: document.id })) ?? document;
  }

  async remove(ctx: RequestContext, id: string) {
    assertRole(ctx, 'member');
    const document = await this.deps.documents.findById({ tenantId: ctx.tenantId, id });
    if (!document) throw new AppError(ErrorCode.NOT_FOUND, 'Document not found');
    await this.deps.storage.delete(document.storageKey).catch((error) => {
      logger.warn(
        {
          tenant_id: ctx.tenantId,
          operation: 'document_storage_delete',
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to delete stored document',
      );
    });
    await this.deps.documents.delete({ tenantId: ctx.tenantId, id });
    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.DOCUMENT_DELETED,
      entityType: 'knowledge_document',
      entityId: id,
      metadata: { title: document.title },
    });
    return document;
  }

  async search(
    ctx: RequestContext,
    input: { embedding?: number[]; query?: string; limit?: number },
  ) {
    assertTenantContext(ctx);
    const limit = input.limit ?? CHUNK_SEARCH_LIMIT;
    if (input.embedding) {
      return this.deps.documents.searchByEmbedding({
        tenantId: ctx.tenantId,
        embedding: input.embedding,
        limit,
      });
    }
    if (input.query) {
      return this.deps.documents.searchByKeyword({
        tenantId: ctx.tenantId,
        query: input.query,
        limit,
      });
    }
    return [];
  }

  async ingest(job: IngestDocumentJob): Promise<void> {
    const document = await this.deps.documents.findById({
      tenantId: job.tenantId,
      id: job.documentId,
    });
    if (!document) return;

    await this.deps.documents.updateStatus({
      tenantId: job.tenantId,
      id: job.documentId,
      status: 'processing',
      error: null,
    });

    try {
      const object = await this.deps.storage.get(document.storageKey);
      const extracted = await this.extractor.extract({ bytes: object.body, mime: document.mime });
      const text = extracted.text.trim();
      if (!text) {
        const error = document.mime === 'application/pdf' ? PDF_NO_TEXT : 'EMPTY_TEXT';
        await this.deps.documents.updateStatus({
          tenantId: job.tenantId,
          id: job.documentId,
          status: 'failed',
          error,
        });
        return;
      }

      const pieces = chunkText(text);
      await this.deps.documents.deleteChunks(job.documentId);
      const rows = await this.deps.documents.createChunks(
        pieces.map((piece) => ({
          tenantId: job.tenantId,
          documentId: job.documentId,
          ordinal: piece.ordinal,
          heading: piece.heading,
          page: extracted.pages && pieces.length === 1 ? 1 : null,
          text: piece.text,
          tokenCount: piece.tokenCount,
        })),
      );

      if (this.deps.embedder && rows.length > 0) {
        for (let offset = 0; offset < rows.length; offset += EMBED_PENDING_BATCH) {
          const batch = rows.slice(offset, offset + EMBED_PENDING_BATCH);
          try {
            const embeddings = await this.deps.embedder.embed(batch.map((row) => row.text));
            for (let index = 0; index < batch.length; index += 1) {
              const embedding = embeddings[index];
              const row = batch[index];
              if (!embedding || !row) continue;
              await this.deps.documents.updateChunkEmbedding({
                tenantId: job.tenantId,
                id: row.id,
                embedding,
              });
            }
          } catch (error) {
            logger.warn(
              {
                tenant_id: job.tenantId,
                operation: 'document_embed',
                document_id: job.documentId,
                err: error instanceof Error ? error.message : String(error),
              },
              'failed to embed document chunks',
            );
          }
        }
      }

      await this.deps.documents.updateStatus({
        tenantId: job.tenantId,
        id: job.documentId,
        status: 'ready',
        error: null,
      });
    } catch (error) {
      logger.warn(
        {
          tenant_id: job.tenantId,
          operation: 'document_ingest',
          document_id: job.documentId,
          err: error instanceof Error ? error.message : String(error),
        },
        'document ingest failed',
      );
      await this.deps.documents.updateStatus({
        tenantId: job.tenantId,
        id: job.documentId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'INGEST_FAILED',
      });
    }
  }

  private async enqueueOrRun(job: IngestDocumentJob) {
    if (this.deps.enqueueIngest) {
      await this.deps.enqueueIngest(job);
      return;
    }
    await this.ingest(job);
  }
}
