import {
  ActivityRepository,
  AuditLogRepository,
  CustomerRepository,
  LeadRepository,
  MembershipRepository,
  prisma,
  ProductRepository,
  SaleRepository,
  SellerRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import {
  ActivityService,
  AuditLogService,
  CustomerService,
  LeadService,
  MembershipService,
  ProductService,
  SaleService,
  SellerService,
  TenantService,
  UserService,
} from '@tactia/domain';
import { betterAuthProvider } from './auth-provider';

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
