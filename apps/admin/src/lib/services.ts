import {
  ActivityRepository,
  AuditLogRepository,
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
  CredentialService,
  CustomDataValidationService,
  CustomFieldDefinitionService,
  DataCatalogService,
  DataSourceService,
  OperatorService,
  SyncService,
} from '@tactia/domain';
import { clientAuthProvider, operatorAuthProvider } from './auth-provider';

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
const rawRecordRepository = new RawRecordRepository(prisma);
const mappingRepository = new MappingRepository(prisma);
const importRepository = new ImportRepository(prisma);
const dataQualityReportRepository = new DataQualityReportRepository(prisma);
const insightRepository = new InsightRepository(prisma);
const customFieldDefinitionRepository = new CustomFieldDefinitionRepository(prisma);

export const auditLogService = new AuditLogService(auditLogRepository);

export const operatorService = new OperatorService(operatorRepository, operatorAuthProvider);

export const credentialService = new CredentialService(credentialRepository);

export const dataSourceService = new DataSourceService(
  dataSourceRepository,
  mappingRepository,
  credentialRepository,
  auditLogService,
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
);
