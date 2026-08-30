import {
  ActivityRepository,
  AuditLogRepository,
  ConversationRepository,
  CredentialRepository,
  CustomerRepository,
  DataQualityReportRepository,
  DataSourceRepository,
  ImportRepository,
  InsightRepository,
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

export const credentialService = new CredentialService(credentialRepository);

export const dataSourceService = new DataSourceService(
  dataSourceRepository,
  mappingRepository,
  credentialRepository,
  auditLogService,
);

export const syncService = new SyncService(
  dataSourceRepository,
  syncJobRepository,
  rawRecordRepository,
  importRepository,
  dataQualityReportRepository,
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

export const conversationService = new ConversationService(
  conversationRepository,
  messageRepository,
  auditLogService,
);
