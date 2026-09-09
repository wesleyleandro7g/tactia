import {
  ActionExecutionRepository,
  ActionRepository,
  ActivityRepository,
  ApprovalRepository,
  AuditLogRepository,
  ConversationRepository,
  CredentialRepository,
  CustomerRepository,
  DataQualityReportRepository,
  DataSourceRepository,
  ImportRepository,
  InsightRepository,
  InteractionRepository,
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
  SyncJobRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import {
  ActivityService,
  AuditLogService,
  ConversationService,
  CredentialService,
  CustomerService,
  DataSourceService,
  ImportService,
  IntelligencePipelineService,
  InsightService,
  InteractionEnrichmentService,
  InteractionService,
  LeadService,
  MembershipService,
  MetricService,
  ProductService,
  RecommendationService,
  SaleService,
  SellerService,
  SyncService,
  TenantService,
  UserService,
} from '@tactia/domain';
import { MetricEngine } from '@tactia/intelligence';
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
  createEmbeddingAdapterFromEnv,
  createLLMAdapterFromEnv,
} from '@tactia/ai';
import { betterAuthProvider } from './auth-provider';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

const tenantRepository = new TenantRepository(prisma);
const userRepository = new UserRepository(prisma);
const membershipRepository = new MembershipRepository(prisma);
const auditLogRepository = new AuditLogRepository(prisma);
const customerRepository = new CustomerRepository(prisma);
const leadRepository = new LeadRepository(prisma);
const productRepository = new ProductRepository(prisma);
const sellerRepository = new SellerRepository(prisma);
const saleRepository = new SaleRepository(prisma);
const activityRepository = new ActivityRepository(prisma);
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
const recommendationRepository = new RecommendationRepository(prisma);
const conversationRepository = new ConversationRepository(prisma);
const messageRepository = new MessageRepository(prisma);
const actionRepository = new ActionRepository(prisma);
const actionExecutionRepository = new ActionExecutionRepository(prisma);
const approvalRepository = new ApprovalRepository(prisma);

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

export const customerService = new CustomerService(customerRepository, auditLogService);

export const leadService = new LeadService(leadRepository, customerRepository, auditLogService);

export const productService = new ProductService(productRepository, auditLogService);

export const sellerService = new SellerService(sellerRepository, auditLogService);

export const saleService = new SaleService(
  saleRepository,
  customerRepository,
  productRepository,
  sellerRepository,
  auditLogService,
);

export const activityService = new ActivityService(
  activityRepository,
  customerRepository,
  leadRepository,
  sellerRepository,
  auditLogService,
);

const llmAdapter = createLLMAdapterFromEnv({
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
});
const embeddingAdapter = createEmbeddingAdapterFromEnv({
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
});
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
});

export const interactionService = new InteractionService(
  interactionRepository,
  customerRepository,
  auditLogService,
  interactionEnrichmentService,
);

export const credentialService = new CredentialService(credentialRepository);

export const dataSourceService = new DataSourceService(
  dataSourceRepository,
  mappingRepository,
  credentialRepository,
  auditLogService,
);

export const importService = new ImportService(importRepository);

const metricEngine = new MetricEngine(prisma);
export const metricService = new MetricService(metricEngine, metricRepository);

export const insightService = new InsightService(insightRepository);

export const recommendationService = new RecommendationService(
  recommendationRepository,
  auditLogService,
);

export const intelligencePipelineService = new IntelligencePipelineService(
  prisma,
  insightRepository,
  recommendationRepository,
  auditLogService,
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
  enrichInteractions: async ({ tenantId, dataSourceId }) => {
    await interactionEnrichmentService.enrichPending({ tenantId, dataSourceId });
  },
  // An import is only useful once it produced insights (spec §2): the pipeline
  // runs right after a successful sync, and a failure here never fails the sync.
  onSyncCompleted: async ({ tenantId, userId }) => {
    await intelligencePipelineService.run({ tenantId, actorCtx: { tenantId, userId } });
  },
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
});

export const actionService = new ActionService(
  actionRepository,
  actionExecutionRepository,
  actionRegistry,
  auditLogService,
);

export const approvalService = new ApprovalService(approvalRepository, executionEngine);
