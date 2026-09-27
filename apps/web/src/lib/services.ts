import {
  CustomFieldDefinitionRepository,
  DataQualityReportRepository,
  DataSourceRepository,
  CampaignRepository,
  CredentialRepository,
  ExpenseRepository,
  GoalRepository,
  ImportRepository,
  InsightFeedbackRepository,
  InventoryLevelRepository,
  IntegrationArtifactRepository,
  IntegrationModuleRunRepository,
  MappingRepository,
  MediaAssetRepository,
  PaymentRepository,
  prisma,
  RawRecordRepository,
  ConversationRepository,
  MessageRepository,
  SyncJobRepository,
  TenantApiKeyRepository,
  TenantSettingsRepository,
  UserRepository,
  WhatsappAuthorizedNumberRepository,
  WhatsappAgentConfigRepository,
  WhatsappAgentJobRepository,
} from '@tactia/database';
import {
  ActivityService,
  CampaignService,
  ConversationService,
  CredentialService,
  CustomFieldDefinitionService,
  DataSourceService,
  ExpenseService,
  GoalService,
  ImportService,
  IntelligencePipelineService,
  InsightFeedbackService,
  InventoryService,
  LeadService,
  MediaIngestService,
  MembershipService,
  PaymentService,
  SnapshotService,
  SyncService,
  ThresholdCalibrator,
  TenantApiKeyService,
  UserService,
  WhatsappAuthorizedNumberService,
  WhatsappAgentConfigService,
  WhatsappAgentJobService,
} from '@tactia/domain';
import { DEFAULT_JOB_RETRY_LIMIT } from '@tactia/execution';
import { createAudioTranscriberFromEnv, createVisionExtractorFromEnv } from '@tactia/ai';
import { createChatServices } from '@tactia/chat/server';
import { betterAuthProvider } from './auth-provider';
import { DAILY_JOB_EXPIRE_SECONDS, getJobQueue, JOBS, jobsEnabled, type IngestDocumentJob, type IngestMediaJob, type SyncJob } from './jobs';

// ---------------------------------------------------------------------------
// Chat stack (shared with apps/admin via @tactia/chat)
// ---------------------------------------------------------------------------

/**
 * Every service used by the chat (tools, context, execution, Browser Agent) is
 * composed once in `@tactia/chat`; the web app adds its own services on top.
 */
export const chatServices = createChatServices({
  prisma,
  executionQueue: getJobQueue() ?? undefined,
  browserQueue: () => getJobQueue(),
  enqueueDocumentIngest: jobsEnabled()
    ? async (job) => {
        const queue = getJobQueue();
        if (!queue) {
          await chatServices.knowledgeDocumentService.ingest(job);
          return;
        }
        await queue.publish<IngestDocumentJob>(JOBS.ingestDocument, job, {
          singletonKey: job.documentId,
        });
      }
    : undefined,
});

const { repositories: chatRepositories, objectStorage, snapshotEngine } = chatServices;

export const {
  customDataValidationService,
  interactionEnrichmentService,
  auditLogService,
  tenantService,
  catalogEmbeddingService,
  dataCatalogService,
  structuredQueryService,
  customerService,
  productService,
  sellerService,
  saleService,
  businessFactService,
  episodeService,
  playbookService,
  interactionService,
  knowledgeDocumentService,
  infographicService,
  metricService,
  analyticsService,
  insightService,
  briefingService,
  recommendationService,
  emailSender,
  actionRegistry,
  executionEngine,
  actionService,
  approvalService,
} = chatServices;

// ---------------------------------------------------------------------------
// Repositories (web-only; chat repositories come from `chatServices`)
// ---------------------------------------------------------------------------

export const tenantRepository = chatRepositories.tenants;
const userRepository = new UserRepository(prisma);
const membershipRepository = chatRepositories.memberships;
const customerRepository = chatRepositories.customers;
const leadRepository = chatRepositories.leads;
const productRepository = chatRepositories.products;
const sellerRepository = chatRepositories.sellers;
const saleRepository = chatRepositories.sales;
const activityRepository = chatRepositories.activities;
const goalRepository = new GoalRepository(prisma);
const businessFactRepository = chatRepositories.businessFacts;
const mediaAssetRepository = new MediaAssetRepository(prisma);
const insightFeedbackRepository = new InsightFeedbackRepository(prisma);
const tenantSettingsRepository = new TenantSettingsRepository(prisma);
const expenseRepository = new ExpenseRepository(prisma);
const paymentRepository = new PaymentRepository(prisma);
const inventoryLevelRepository = new InventoryLevelRepository(prisma);
const campaignRepository = new CampaignRepository(prisma);
const customFieldDefinitionRepository: CustomFieldDefinitionRepository =
  chatRepositories.customFieldDefinitions;
const interactionRepository = chatRepositories.interactions;
const credentialRepository = new CredentialRepository(prisma);
const dataSourceRepository = new DataSourceRepository(prisma);
const syncJobRepository = new SyncJobRepository(prisma);
const integrationModuleRunRepository = new IntegrationModuleRunRepository(prisma);
const integrationArtifactRepository = new IntegrationArtifactRepository(prisma);
const rawRecordRepository = new RawRecordRepository(prisma);
const mappingRepository = new MappingRepository(prisma);
const importRepository = new ImportRepository(prisma);
const dataQualityReportRepository = new DataQualityReportRepository(prisma);
const insightRepository = chatRepositories.insights;
const recommendationRepository = chatRepositories.recommendations;
const conversationRepository = new ConversationRepository(prisma);
const messageRepository = new MessageRepository(prisma);
const tenantApiKeyRepository = new TenantApiKeyRepository(prisma);
const whatsappAuthorizedNumberRepository = new WhatsappAuthorizedNumberRepository(prisma);

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const userService = new UserService(
  userRepository,
  membershipRepository,
  auditLogService,
  betterAuthProvider,
);

export const membershipService = new MembershipService(membershipRepository, auditLogService);

export const customFieldDefinitionService = new CustomFieldDefinitionService(
  customFieldDefinitionRepository,
  auditLogService,
  dataCatalogService,
);

export const leadService = new LeadService(leadRepository, customerRepository, auditLogService, prisma);

export const activityService = new ActivityService(
  activityRepository,
  customerRepository,
  leadRepository,
  sellerRepository,
  auditLogService,
);

export const goalService = new GoalService(goalRepository);
export const expenseService = new ExpenseService(expenseRepository);
export const paymentService = new PaymentService(paymentRepository, saleRepository);
export const inventoryService = new InventoryService(inventoryLevelRepository, productRepository);
export const campaignService = new CampaignService(campaignRepository);

export { insightFeedbackRepository, tenantSettingsRepository };

export const insightFeedbackService = new InsightFeedbackService(
  insightFeedbackRepository,
  insightRepository,
);

const thresholdCalibrator = new ThresholdCalibrator(
  insightFeedbackRepository,
  tenantSettingsRepository,
);

const visionExtractor = createVisionExtractorFromEnv({
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_VISION_MODEL: process.env.LLM_VISION_MODEL,
  STT_MODEL: process.env.STT_MODEL,
});
const audioTranscriber = createAudioTranscriberFromEnv({
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_VISION_MODEL: process.env.LLM_VISION_MODEL,
  STT_MODEL: process.env.STT_MODEL,
});

export const mediaIngestService = new MediaIngestService({
  media: mediaAssetRepository,
  storage: objectStorage,
  dataSources: dataSourceRepository,
  rawRecords: rawRecordRepository,
  interactions: interactionRepository,
  documents: knowledgeDocumentService,
  vision: visionExtractor,
  transcriber: audioTranscriber,
  enrichment: interactionEnrichmentService,
  enqueueIngest: jobsEnabled()
    ? async (job) => {
        const queue = getJobQueue();
        if (!queue) {
          await mediaIngestService.ingest(job);
          return;
        }
        await queue.publish<IngestMediaJob>(JOBS.ingestMedia, job, {
          singletonKey: job.mediaId,
        });
      }
    : undefined,
});

export const credentialService = new CredentialService(credentialRepository);

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

export const whatsappAgentJobService = new WhatsappAgentJobService(
  new WhatsappAgentJobRepository(prisma),
);

export const dataSourceService = new DataSourceService(
  dataSourceRepository,
  mappingRepository,
  credentialRepository,
  auditLogService,
);

export const importService = new ImportService(importRepository);

export const snapshotService = new SnapshotService(prisma, snapshotEngine);

export const intelligencePipelineService = new IntelligencePipelineService(
  prisma,
  insightRepository,
  recommendationRepository,
  auditLogService,
  {
    snapshots: snapshotEngine,
    thresholds: (tenantId) => thresholdCalibrator.calibrate(tenantId),
    facts: async (tenantId) => {
      const items = await businessFactRepository.listActive(tenantId, new Date());
      return items.map((fact) => ({
        kind: fact.kind as 'fact' | 'event' | 'preference',
        text: fact.text,
        entityType: fact.entityType,
        entityId: fact.entityId,
        validFrom: fact.validFrom,
        validTo: fact.validTo,
      }));
    },
  },
);

export const syncService = new SyncService({
  dataSources: dataSourceRepository,
  syncJobs: syncJobRepository,
  rawRecords: rawRecordRepository,
  imports: importRepository,
  qualityReports: dataQualityReportRepository,
  moduleRuns: integrationModuleRunRepository,
  artifacts: integrationArtifactRepository,
  objectStorage,
  maxSyncAttempts: DEFAULT_JOB_RETRY_LIMIT + 1,
  mappings: mappingRepository,
  credentials: credentialRepository,
  auditLogs: auditLogService,
  customers: customerRepository,
  products: productRepository,
  sellers: sellerRepository,
  sales: saleRepository,
  interactions: interactionRepository,
  leads: leadRepository,
  activities: activityRepository,
  expenses: expenseRepository,
  payments: paymentRepository,
  inventoryLevels: inventoryLevelRepository,
  campaigns: campaignRepository,
  customData: customDataValidationService,
  enrichInteractions: async ({ tenantId, dataSourceId }) => {
    await interactionEnrichmentService.enrichPending({ tenantId, dataSourceId });
  },
  // An import is only useful once it produced insights (spec §2): the pipeline
  // runs right after a successful sync, and a failure here never fails the sync.
  onSyncCompleted: async ({ tenantId, userId }) => {
    await intelligencePipelineService.run({ tenantId, actorCtx: { tenantId, userId } });
  },
  enqueueSync: jobsEnabled()
    ? async (job) => {
        const queue = getJobQueue();
        if (!queue) {
          await syncService.executeSync(job.tenantId, job.syncJobId, job);
          return;
        }
        await queue.publish<SyncJob>(JOBS.sync, job, {
          singletonKey: job.syncJobId,
          expireInSeconds: DAILY_JOB_EXPIRE_SECONDS,
        });
      }
    : undefined,
});

export const conversationService = new ConversationService(
  conversationRepository,
  messageRepository,
  auditLogService,
);
