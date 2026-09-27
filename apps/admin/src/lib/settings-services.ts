import {
  DataSourceRepository,
  MediaAssetRepository,
  MembershipRepository,
  prisma,
  RawRecordRepository,
  TenantApiKeyRepository,
  TenantRepository,
  WhatsappAuthorizedNumberRepository,
} from '@tactia/database';
import {
  MediaIngestService,
  TenantApiKeyService,
  WhatsappAuthorizedNumberService,
} from '@tactia/domain';
import { createAudioTranscriberFromEnv, createVisionExtractorFromEnv } from '@tactia/ai';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { chatServices } from './chat';
import { operatorTenantContext } from './operator-tenant';

/**
 * Services that give operators parity with the client app's `/settings/*`
 * features (WhatsApp, API keys, documents, playbooks, connections). They are
 * composed once here and reused by the tenant-scoped admin libs.
 *
 * Playbooks, documents and object storage come from the shared chat stack
 * (`@tactia/chat`) so the admin runs exactly the same services as apps/web.
 */
const auditLogService = chatServices.auditLogService;
const objectStorage = chatServices.objectStorage;

// Shared from the chat stack -------------------------------------------------
export const playbookService = chatServices.playbookService;
export const knowledgeDocumentService = chatServices.knowledgeDocumentService;

// Admin-only compositions ----------------------------------------------------
const membershipRepository = new MembershipRepository(prisma);
const tenantApiKeyRepository = new TenantApiKeyRepository(prisma);
const whatsappAuthorizedNumberRepository = new WhatsappAuthorizedNumberRepository(prisma);
const mediaAssetRepository = new MediaAssetRepository(prisma);
const dataSourceRepository = new DataSourceRepository(prisma);
const rawRecordRepository = new RawRecordRepository(prisma);

export const tenantApiKeyService = new TenantApiKeyService(tenantApiKeyRepository, auditLogService);

export const whatsappAuthorizedNumberService = new WhatsappAuthorizedNumberService(
  whatsappAuthorizedNumberRepository,
  membershipRepository,
  auditLogService,
);

const visionEnv = {
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_VISION_MODEL: process.env.LLM_VISION_MODEL,
  STT_MODEL: process.env.STT_MODEL,
};

export const mediaIngestService = new MediaIngestService({
  media: mediaAssetRepository,
  storage: objectStorage,
  dataSources: dataSourceRepository,
  rawRecords: rawRecordRepository,
  interactions: chatServices.repositories.interactions,
  documents: knowledgeDocumentService,
  vision: createVisionExtractorFromEnv(visionEnv),
  transcriber: createAudioTranscriberFromEnv(visionEnv),
  enrichment: chatServices.interactionEnrichmentService,
  // The admin never registers the ingest worker: fall back to inline ingestion.
});

const tenants = new TenantRepository(prisma);

/**
 * Tenant-scoped operator context for the settings features. Mirrors
 * `chatTenantContext`: deleted/unknown tenants are hidden (404) and the
 * resulting context carries `operatorId` + `tenantId` with role `owner` so the
 * domain services attribute every mutation to the operator in the audit log.
 */
export async function scopedTenant(ctx: RequestContext, tenantId: string): Promise<RequestContext> {
  const scoped = operatorTenantContext(ctx, tenantId);
  if (!(await tenants.findByIdForOperator(tenantId))) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');
  }
  return scoped;
}
