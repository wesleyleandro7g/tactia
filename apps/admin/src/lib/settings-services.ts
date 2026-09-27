import {
  DataSourceRepository,
  MediaAssetRepository,
  MembershipRepository,
  prisma,
  CredentialRepository,
  RawRecordRepository,
  ScheduleOccurrenceRepository,
  ScheduleRepository,
  TenantApiKeyRepository,
  TenantRepository,
  WhatsappAuthorizedNumberRepository,
  WhatsappAgentConfigRepository,
} from '@tactia/database';
import {
  EmailConfigService,
  MediaIngestService,
  ScheduleService,
  TenantApiKeyService,
  WhatsappAuthorizedNumberService,
  WhatsappAgentConfigService,
} from '@tactia/domain';
import { ScheduleRunner, type ScheduleAgentRunner } from '@tactia/execution';
import { createAudioTranscriberFromEnv, createVisionExtractorFromEnv, type ToolContext } from '@tactia/ai';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { chatServices, chatRuntime } from './chat';
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

export const whatsappAgentConfigService = new WhatsappAgentConfigService(
  new WhatsappAgentConfigRepository(prisma),
  auditLogService,
);

export const emailConfigService = new EmailConfigService(
  new CredentialRepository(prisma),
  auditLogService,
);

// Scheduling -----------------------------------------------------------------
const scheduleRepository = new ScheduleRepository(prisma);
const scheduleOccurrenceRepository = new ScheduleOccurrenceRepository(prisma);
const tenantsForSchedule = new TenantRepository(prisma);

/**
 * Resolves a real principal (the tenant owner) so the AI read path accepts the
 * headless run: the context builder/tools require an authenticated member.
 */
async function resolveScheduleAgentContext(tenantId: string, requestId: string): Promise<ToolContext> {
  const page = await membershipRepository.listByTenant({ tenantId, skip: 0, take: 100 });
  const active = page.items.filter((m) => m.status === 'active');
  const principal =
    active.find((m) => m.role === 'owner') ??
    active.find((m) => m.role === 'admin') ??
    active[0];
  if (!principal) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Nenhum usuário ativo para executar o agente neste agendamento.');
  }
  return { requestId, tenantId, userId: principal.userId, role: principal.role, operatorId: null, ip: null };
}

/** ai_agent runner backed by the admin chat runtime (same stack as apps/web). */
const scheduleAgentRunner: ScheduleAgentRunner = {
  async run({ ctx, aiConfig }) {
    const toolCtx = await resolveScheduleAgentContext(ctx.tenantId as string, ctx.requestId);
    const question = aiConfig.systemPrompt
      ? `${aiConfig.systemPrompt}\n\n${aiConfig.instruction}`
      : aiConfig.instruction;
    const answer = await chatRuntime.getOrchestrator().run({ ctx: toolCtx, question, history: [] });
    return {
      summary: answer.content,
      proposals: answer.proposals?.length ?? 0,
      toolCalls: answer.toolCalls?.map((call) => call.name) ?? [],
    };
  },
};

export const scheduleRunner = new ScheduleRunner({
  schedules: scheduleRepository,
  occurrences: scheduleOccurrenceRepository,
  engine: chatServices.executionEngine,
  auditLogs: auditLogService,
  agentRunner: scheduleAgentRunner,
});

export const scheduleService = new ScheduleService({
  schedules: scheduleRepository,
  occurrences: scheduleOccurrenceRepository,
  auditLogs: auditLogService,
  tenantTimezone: async (tenantId) => {
    const tenant = await tenantsForSchedule.findById({ tenantId });
    return tenant?.timezone;
  },
  // The admin runs the occurrence inline (it does not register the pg-boss
  // worker). The web tick still fires automatic occurrences on schedule.
  enqueueRun: async ({ tenantId, occurrenceId }) => {
    await scheduleRunner.run(tenantId, occurrenceId);
  },
});

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
