import {
  ActivityRepository,
  AuditLogRepository,
  BrowserExecutorInstanceRepository,
  BrowserWorkflowBindingRepository,
  BrowserWorkflowRepository,
  CommandCenterEventRepository,
  CommandCenterRepository,
  GoalRepository,
  EvidenceClarificationRepository,
  CampaignRepository,
  CredentialRepository,
  CustomFieldDefinitionRepository,
  CustomerRepository,
  DataQualityReportRepository,
  DataSourceRepository,
  ExpenseRepository,
  ImportRepository,
  InsightRepository,
  InteractionRepository,
  InventoryLevelRepository,
  IntegrationArtifactRepository,
  IntegrationModuleRunRepository,
  LeadRepository,
  MappingRepository,
  MembershipRepository,
  OperatorRepository,
  PaymentRepository,
  prisma,
  ProductRepository,
  RawRecordRepository,
  SaleRepository,
  SellerRepository,
  SyncJobRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import {
  AuditLogService,
  BackofficeService,
  BrowserIntegrationService,
  CredentialService,
  CustomDataValidationService,
  CustomFieldDefinitionService,
  DataCatalogService,
  DataSourceService,
  CommandCenterMetricsService,
  CommandCenterService,
  GoalService,
  EvidenceClarificationService,
  EvidenceGapService,
  OperatorService,
  SyncService,
} from '@tactia/domain';
import { clientAuthProvider, operatorAuthProvider } from './auth-provider';
import { createObjectStorageFromEnv } from '@tactia/shared/storage';
import { DEFAULT_JOB_RETRY_LIMIT, PgBossJobQueue } from '@tactia/execution';

const tenantRepository = new TenantRepository(prisma);
const userRepository = new UserRepository(prisma);
const membershipRepository = new MembershipRepository(prisma);
const operatorRepository = new OperatorRepository(prisma);
const auditLogRepository = new AuditLogRepository(prisma);
const customerRepository = new CustomerRepository(prisma);
const leadRepository = new LeadRepository(prisma);
const productRepository = new ProductRepository(prisma);
const sellerRepository = new SellerRepository(prisma);
const saleRepository = new SaleRepository(prisma);
const activityRepository = new ActivityRepository(prisma);
const expenseRepository = new ExpenseRepository(prisma);
const paymentRepository = new PaymentRepository(prisma);
const inventoryLevelRepository = new InventoryLevelRepository(prisma);
const campaignRepository = new CampaignRepository(prisma);
const interactionRepository = new InteractionRepository(prisma);
const credentialRepository = new CredentialRepository(prisma);
const dataSourceRepository = new DataSourceRepository(prisma);
const syncJobRepository = new SyncJobRepository(prisma);
const integrationModuleRunRepository = new IntegrationModuleRunRepository(prisma);
const integrationArtifactRepository = new IntegrationArtifactRepository(prisma);
const rawRecordRepository = new RawRecordRepository(prisma);
const mappingRepository = new MappingRepository(prisma);
const importRepository = new ImportRepository(prisma);
const dataQualityReportRepository = new DataQualityReportRepository(prisma);
const insightRepository = new InsightRepository(prisma);
const customFieldDefinitionRepository = new CustomFieldDefinitionRepository(prisma);
const browserExecutorInstanceRepository = new BrowserExecutorInstanceRepository(prisma);
const browserWorkflowRepository = new BrowserWorkflowRepository(prisma);
const browserWorkflowBindingRepository = new BrowserWorkflowBindingRepository(prisma);
const commandCenterRepository = new CommandCenterRepository(prisma);
const goalRepository = new GoalRepository(prisma);

export const auditLogService = new AuditLogService(auditLogRepository);
export const commandCenterService = new CommandCenterService(commandCenterRepository);
export const commandCenterMetricsService = new CommandCenterMetricsService(
  new CommandCenterEventRepository(prisma),
);
export const goalService = new GoalService(goalRepository);
export const evidenceGapService = new EvidenceGapService(commandCenterRepository);
export const evidenceClarificationService = new EvidenceClarificationService(
  new EvidenceClarificationRepository(prisma),
);

export const operatorService = new OperatorService(operatorRepository, operatorAuthProvider);

export const credentialService = new CredentialService(credentialRepository);

export const browserIntegrationService = new BrowserIntegrationService({
  instances: browserExecutorInstanceRepository,
  workflows: browserWorkflowRepository,
  bindings: browserWorkflowBindingRepository,
  credentials: credentialRepository,
});

export const dataSourceService = new DataSourceService(
  dataSourceRepository,
  mappingRepository,
  credentialRepository,
  auditLogService,
  rawRecordRepository,
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

const objectStorage = createObjectStorageFromEnv();
const adminJobQueue = process.env['JOBS_ENABLED'] === 'true' && process.env['DATABASE_URL']
  ? new PgBossJobQueue({ connectionString: process.env['DATABASE_URL'], retryLimit: DEFAULT_JOB_RETRY_LIMIT })
  : null;

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
  enqueueSync: adminJobQueue
    ? async (job) => {
        await adminJobQueue.publish('sync.execute', job, { singletonKey: job.syncJobId, expireInSeconds: 2 * 60 * 60 });
      }
    : undefined,
  customData: customDataValidationService,
});

export const backofficeService = new BackofficeService(
  tenantRepository,
  userRepository,
  membershipRepository,
  dataSourceRepository,
  syncJobRepository,
  importRepository,
  insightRepository,
  auditLogService,
  auditLogRepository,
  clientAuthProvider,
  syncService,
  dataSourceService,
  credentialService,
  customFieldDefinitionService,
  integrationModuleRunRepository,
  integrationArtifactRepository,
  objectStorage,
);
