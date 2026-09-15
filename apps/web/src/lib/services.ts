import {
  ActionExecutionRepository,
  ActionRepository,
  ActivityRepository,
  ApprovalRepository,
  AuditLogRepository,
  BusinessFactRepository,
  CampaignRepository,
  ConversationRepository,
  CredentialRepository,
  CustomFieldDefinitionRepository,
  CustomerRepository,
  DataQualityReportRepository,
  DataSourceRepository,
  ExpenseRepository,
  ImportRepository,
  BriefingRepository,
  InsightFeedbackRepository,
  InsightRepository,
  InteractionRepository,
  InventoryLevelRepository,
  LeadRepository,
  MappingRepository,
  MembershipRepository,
  MessageRepository,
  MetricRepository,
  prisma,
  ProductRepository,
  RawRecordRepository,
  RecommendationRepository,
  SaleRepository,
  SellerRepository,
  StructuredQueryRepository,
  SyncJobRepository,
  TenantRepository,
  TenantSettingsRepository,
  UserRepository,
  GoalRepository,
  PaymentRepository,
  EpisodeRepository,
  PlaybookRepository,
  KnowledgeDocumentRepository,
  MediaAssetRepository,
  InfographicAssetRepository,
  TenantApiKeyRepository,
  WhatsappAuthorizedNumberRepository,
} from '@tactia/database';
import {
  ActivityService,
  AnalyticsService,
  AuditLogService,
  BriefingService,
  BusinessFactService,
  CampaignService,
  CatalogEmbeddingService,
  ConversationService,
  CredentialService,
  CustomDataValidationService,
  CustomFieldDefinitionService,
  CustomerService,
  DataCatalogService,
  DataSourceService,
  ExpenseService,
  GoalService,
  ImportService,
  IntelligencePipelineService,
  InsightFeedbackService,
  InsightService,
  InteractionEnrichmentService,
  InteractionService,
  InventoryService,
  KnowledgeDocumentService,
  LeadService,
  MediaIngestService,
  InfographicService,
  MembershipService,
  MetricService,
  EpisodeService,
  PaymentService,
  PlaybookService,
  ProductService,
  RecommendationService,
  SaleService,
  SellerService,
  SnapshotService,
  StructuredQueryService,
  SyncService,
  TenantService,
  ThresholdCalibrator,
  TenantApiKeyService,
  UserService,
  WhatsappAuthorizedNumberService,
} from '@tactia/domain';
import { MetricEngine, SnapshotEngine } from '@tactia/intelligence';
import {
  ActionService,
  ApprovalService,
  ConsoleEmailSender,
  ExecutionEngine,
  createDefaultActionRegistry,
} from '@tactia/execution';
import {
  KeywordInteractionClassifier,
  LlmInteractionClassifier,
  createAudioTranscriberFromEnv,
  createEmbeddingAdapterFromEnv,
  createLLMAdapterFromEnv,
  createVisionExtractorFromEnv,
} from '@tactia/ai';
import { createObjectStorageFromEnv } from '@tactia/shared/storage';
import { betterAuthProvider } from './auth-provider';
import { getJobQueue, JOBS, jobsEnabled, type IngestDocumentJob, type IngestMediaJob, type SyncJob } from './jobs';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export const tenantRepository = new TenantRepository(prisma);
const userRepository = new UserRepository(prisma);
const membershipRepository = new MembershipRepository(prisma);
const auditLogRepository = new AuditLogRepository(prisma);
const customerRepository = new CustomerRepository(prisma);
const leadRepository = new LeadRepository(prisma);
const productRepository = new ProductRepository(prisma);
const sellerRepository = new SellerRepository(prisma);
const saleRepository = new SaleRepository(prisma);
const activityRepository = new ActivityRepository(prisma);
const goalRepository = new GoalRepository(prisma);
const businessFactRepository = new BusinessFactRepository(prisma);
const episodeRepository = new EpisodeRepository(prisma);
const playbookRepository = new PlaybookRepository(prisma);
const knowledgeDocumentRepository = new KnowledgeDocumentRepository(prisma);
const mediaAssetRepository = new MediaAssetRepository(prisma);
const infographicAssetRepository = new InfographicAssetRepository(prisma);
const insightFeedbackRepository = new InsightFeedbackRepository(prisma);
const tenantSettingsRepository = new TenantSettingsRepository(prisma);
const expenseRepository = new ExpenseRepository(prisma);
const paymentRepository = new PaymentRepository(prisma);
const inventoryLevelRepository = new InventoryLevelRepository(prisma);
const campaignRepository = new CampaignRepository(prisma);
const customFieldDefinitionRepository = new CustomFieldDefinitionRepository(prisma);
const interactionRepository = new InteractionRepository(prisma);
const credentialRepository = new CredentialRepository(prisma);
const dataSourceRepository = new DataSourceRepository(prisma);
const syncJobRepository = new SyncJobRepository(prisma);
const rawRecordRepository = new RawRecordRepository(prisma);
const mappingRepository = new MappingRepository(prisma);
const importRepository = new ImportRepository(prisma);
const dataQualityReportRepository = new DataQualityReportRepository(prisma);
const metricRepository = new MetricRepository(prisma);
const insightRepository = new InsightRepository(prisma);
const briefingRepository = new BriefingRepository(prisma);
const recommendationRepository = new RecommendationRepository(prisma);
const conversationRepository = new ConversationRepository(prisma);
const messageRepository = new MessageRepository(prisma);
const actionRepository = new ActionRepository(prisma);
const actionExecutionRepository = new ActionExecutionRepository(prisma);
const approvalRepository = new ApprovalRepository(prisma);
const tenantApiKeyRepository = new TenantApiKeyRepository(prisma);
const whatsappAuthorizedNumberRepository = new WhatsappAuthorizedNumberRepository(prisma);

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const auditLogService = new AuditLogService(auditLogRepository);

export const tenantService = new TenantService(tenantRepository, membershipRepository, auditLogService);

export const userService = new UserService(
  userRepository,
  membershipRepository,
  auditLogService,
  betterAuthProvider,
);

export const membershipService = new MembershipService(membershipRepository, auditLogService);

const embeddingAdapter = createEmbeddingAdapterFromEnv({
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
});

export const catalogEmbeddingService = new CatalogEmbeddingService(
  productRepository,
  customerRepository,
  embeddingAdapter,
);

export const customDataValidationService = new CustomDataValidationService(
  customFieldDefinitionRepository,
);
export const dataCatalogService = new DataCatalogService(customFieldDefinitionRepository);
export const customFieldDefinitionService = new CustomFieldDefinitionService(
  customFieldDefinitionRepository,
  auditLogService,
  dataCatalogService,
);
export const structuredQueryService = new StructuredQueryService(
  dataCatalogService,
  new StructuredQueryRepository(prisma),
);

export const customerService = new CustomerService(
  customerRepository,
  auditLogService,
  catalogEmbeddingService,
  customDataValidationService,
);

export const leadService = new LeadService(leadRepository, customerRepository, auditLogService, prisma);

export const productService = new ProductService(
  productRepository,
  auditLogService,
  catalogEmbeddingService,
  customDataValidationService,
);

export const sellerService = new SellerService(sellerRepository, auditLogService);

export const saleService = new SaleService(
  saleRepository,
  customerRepository,
  productRepository,
  sellerRepository,
  auditLogService,
  customDataValidationService,
);

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

// Classification runs over thousands of short messages: it uses the cheaper
// tier (LLM_CLASSIFIER_MODEL), while the chat uses the strong model (lib/ai.ts).
const llmAdapter = createLLMAdapterFromEnv(
  {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_CLASSIFIER_MODEL: process.env.LLM_CLASSIFIER_MODEL,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
  },
  'classifier',
);

export const businessFactService = new BusinessFactService(businessFactRepository, embeddingAdapter);
export const episodeService = new EpisodeService(episodeRepository, embeddingAdapter);
export const playbookService = new PlaybookService(playbookRepository, auditLogService, embeddingAdapter);
const interactionClassifier =
  process.env.LLM_PROVIDER === 'mock'
    ? new KeywordInteractionClassifier()
    : llmAdapter
      ? new LlmInteractionClassifier(llmAdapter)
      : null;

export const interactionEnrichmentService = new InteractionEnrichmentService({
  interactions: interactionRepository,
  classifier: interactionClassifier,
  embedder: embeddingAdapter,
  products: productRepository,
});

export const interactionService = new InteractionService(
  interactionRepository,
  customerRepository,
  auditLogService,
  interactionEnrichmentService,
);

const objectStorage = createObjectStorageFromEnv();
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

export const knowledgeDocumentService = new KnowledgeDocumentService({
  documents: knowledgeDocumentRepository,
  storage: objectStorage,
  auditLogs: auditLogService,
  embedder: embeddingAdapter,
  enqueueIngest: jobsEnabled()
    ? async (job) => {
        const queue = getJobQueue();
        if (!queue) {
          await knowledgeDocumentService.ingest(job);
          return;
        }
        await queue.publish<IngestDocumentJob>(JOBS.ingestDocument, job, {
          singletonKey: job.documentId,
        });
      }
    : undefined,
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

export const infographicService = new InfographicService(infographicAssetRepository, objectStorage);

export const credentialService = new CredentialService(credentialRepository);

export const tenantApiKeyService = new TenantApiKeyService(tenantApiKeyRepository, auditLogService);

export const whatsappAuthorizedNumberService = new WhatsappAuthorizedNumberService(
  whatsappAuthorizedNumberRepository,
  membershipRepository,
  auditLogService,
);

export const dataSourceService = new DataSourceService(
  dataSourceRepository,
  mappingRepository,
  credentialRepository,
  auditLogService,
);

export const importService = new ImportService(importRepository);

const metricEngine = new MetricEngine(prisma);
export const metricService = new MetricService(metricEngine, metricRepository);
// One snapshot engine shared by analytics (trends), the pipeline (baselines) and jobs.
const snapshotEngine = new SnapshotEngine(prisma, metricEngine);
export const snapshotService = new SnapshotService(prisma, snapshotEngine);
export const analyticsService = new AnalyticsService(prisma, snapshotEngine);

export const insightService = new InsightService(insightRepository);

const briefingNarratorAdapter = createLLMAdapterFromEnv(
  {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
  },
  'chat',
);
export const briefingService = new BriefingService(
  prisma,
  briefingRepository,
  briefingNarratorAdapter
    ? {
        narrate: async ({ system, user }) => {
          const result = await briefingNarratorAdapter.complete({
            system,
            messages: [{ role: 'user', content: user }],
            temperature: 0.3,
            maxOutputTokens: 1200,
          });
          return { text: result.text, model: briefingNarratorAdapter.model };
        },
      }
    : null,
);

export const recommendationService = new RecommendationService(
  recommendationRepository,
  auditLogService,
);

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
        await queue.publish<SyncJob>(JOBS.sync, job, { singletonKey: job.syncJobId });
      }
    : undefined,
});

export const conversationService = new ConversationService(
  conversationRepository,
  messageRepository,
  auditLogService,
);

// ---------------------------------------------------------------------------
// Execution (Etapa 7)
// ---------------------------------------------------------------------------

/**
 * Executors receive repositories, not services: an execution may run after the
 * request that proposed it, so there is no session to authorize against.
 * Authorization happens when proposing and approving.
 */
export const emailSender = new ConsoleEmailSender();

export const actionRegistry = createDefaultActionRegistry({
  activities: activityRepository,
  customers: customerRepository,
  leads: leadRepository,
  sellers: sellerRepository,
  emailSender,
});

export const executionEngine = new ExecutionEngine({
  actions: actionRepository,
  executions: actionExecutionRepository,
  approvals: approvalRepository,
  registry: actionRegistry,
  auditLogs: auditLogService,
  queue: getJobQueue() ?? undefined,
  episodes: {
    record: async (input) => {
      await episodeService.record(input);
    },
  },
});

export const actionService = new ActionService(
  actionRepository,
  actionExecutionRepository,
  actionRegistry,
  auditLogService,
);

export const approvalService = new ApprovalService(approvalRepository, executionEngine);
