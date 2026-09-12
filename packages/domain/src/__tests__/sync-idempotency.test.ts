import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ActivityRepository,
  AuditLogRepository,
  CampaignRepository,
  CredentialRepository,
  CustomerRepository,
  DataQualityReportRepository,
  DataSourceRepository,
  ExpenseRepository,
  ImportRepository,
  InteractionRepository,
  InventoryLevelRepository,
  LeadRepository,
  MappingRepository,
  prisma,
  PaymentRepository,
  ProductRepository,
  RawRecordRepository,
  SaleRepository,
  SellerRepository,
  SyncJobRepository,
} from '@tactia/database';
import { createId, type RequestContext } from '@tactia/shared';
import { AuditLogService } from '../services/audit-log-service';
import { SyncService } from '../services/sync-service';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(__dirname, 'fixtures', name);

// Use test DB
const auditLogRepo = new AuditLogRepository(prisma);
const auditLogs = new AuditLogService(auditLogRepo);
const dataSourceRepo = new DataSourceRepository(prisma);
const syncJobRepo = new SyncJobRepository(prisma);
const rawRecordRepo = new RawRecordRepository(prisma);
const importRepo = new ImportRepository(prisma);
const qualityRepo = new DataQualityReportRepository(prisma);
const mappingRepo = new MappingRepository(prisma);
const credentialRepo = new CredentialRepository(prisma);
const customerRepo = new CustomerRepository(prisma);
const productRepo = new ProductRepository(prisma);
const sellerRepo = new SellerRepository(prisma);
const saleRepo = new SaleRepository(prisma);
const interactionRepo = new InteractionRepository(prisma);
const leadRepo = new LeadRepository(prisma);
const activityRepo = new ActivityRepository(prisma);
const expenseRepo = new ExpenseRepository(prisma);
const paymentRepo = new PaymentRepository(prisma);
const inventoryLevelRepo = new InventoryLevelRepository(prisma);
const campaignRepo = new CampaignRepository(prisma);

const pipelineCalls: string[] = [];

const syncService = new SyncService({
  dataSources: dataSourceRepo,
  syncJobs: syncJobRepo,
  rawRecords: rawRecordRepo,
  imports: importRepo,
  qualityReports: qualityRepo,
  mappings: mappingRepo,
  credentials: credentialRepo,
  auditLogs,
  customers: customerRepo,
  products: productRepo,
  sellers: sellerRepo,
  sales: saleRepo,
  interactions: interactionRepo,
  leads: leadRepo,
  activities: activityRepo,
  expenses: expenseRepo,
  payments: paymentRepo,
  inventoryLevels: inventoryLevelRepo,
  campaigns: campaignRepo,
  onSyncCompleted: async ({ syncJobId }) => {
    pipelineCalls.push(syncJobId);
  },
});

let tenantId: string;
let dataSourceId: string;
let productSourceId: string;
let sellerSourceId: string;
let saleSourceId: string;
let ctx: RequestContext;
let authUserId: string;
let userId: string;

/** Creates a CSV DataSource with a single active mapping. */
async function createCsvSource(input: {
  name: string;
  filePath: string;
  targetEntity: string;
  fields: Array<{ source: string; target: string }>;
}) {
  const ds = await dataSourceRepo.create({
    tenantId,
    type: 'csv',
    name: input.name,
    configuration: { filePath: input.filePath },
  });
  await mappingRepo.create({
    tenantId,
    dataSourceId: ds.id,
    sourceEntity: 'data',
    targetEntity: input.targetEntity,
    configuration: { fields: input.fields },
  });
  return ds.id;
}

beforeAll(async () => {
  // Create test tenant
  tenantId = createId();
  await prisma.tenant.create({
    data: { id: tenantId, name: 'Sync Test Tenant', slug: `sync-test-${tenantId.slice(0, 8)}` },
  });

  // Create auth user + domain user.
  // The e-mail carries the full id: UUID v7 prefixes only change every ~65s, so
  // a truncated id would collide when the suite runs twice in a row.
  authUserId = createId();
  const email = `sync-test-${authUserId}@sync.local`;
  await prisma.authUser.create({
    data: { id: authUserId, name: 'Test', email, emailVerified: true },
  });
  await prisma.authAccount.create({
    data: { id: createId(), accountId: authUserId, providerId: 'credential', userId: authUserId, password: 'x' },
  });
  userId = createId();
  await prisma.user.create({
    data: { id: userId, externalAuthId: authUserId, name: 'Test', email },
  });
  await prisma.membership.create({
    data: { id: createId(), tenantId, userId, role: 'owner', status: 'active' },
  });

  ctx = { requestId: createId(), tenantId, userId, role: 'owner' };

  dataSourceId = await createCsvSource({
    name: 'Sample CSV',
    filePath: fixture('sample-customers.csv'),
    targetEntity: 'customer',
    fields: [
      { source: 'external_id', target: 'external_id' },
      { source: 'name', target: 'name' },
      { source: 'email', target: 'email' },
      { source: 'phone', target: 'phone' },
    ],
  });

  productSourceId = await createCsvSource({
    name: 'Produtos CSV',
    filePath: fixture('sample-products.csv'),
    targetEntity: 'product',
    fields: [
      { source: 'external_id', target: 'external_id' },
      { source: 'name', target: 'name' },
      { source: 'sku', target: 'sku' },
      { source: 'category', target: 'category' },
      { source: 'price', target: 'price' },
    ],
  });

  sellerSourceId = await createCsvSource({
    name: 'Vendedores CSV',
    filePath: fixture('sample-sellers.csv'),
    targetEntity: 'seller',
    fields: [
      { source: 'external_id', target: 'external_id' },
      { source: 'name', target: 'name' },
      { source: 'email', target: 'email' },
    ],
  });

  saleSourceId = await createCsvSource({
    name: 'Vendas CSV',
    filePath: fixture('sample-sales.csv'),
    targetEntity: 'sale',
    fields: [
      { source: 'external_id', target: 'external_id' },
      { source: 'customer_external_id', target: 'customer_external_id' },
      { source: 'seller_external_id', target: 'seller_external_id' },
      { source: 'product_external_id', target: 'product_external_id' },
      { source: 'quantity', target: 'quantity' },
      { source: 'unit_price', target: 'unit_price' },
      { source: 'total_amount', target: 'total_amount' },
      { source: 'sold_at', target: 'sold_at' },
      { source: 'status', target: 'status' },
    ],
  });
});

afterAll(async () => {
  // Cascade delete via tenant, then the identity rows (not owned by the tenant)
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.authSession.deleteMany({ where: { userId: authUserId } });
  await prisma.authAccount.deleteMany({ where: { userId: authUserId } });
  await prisma.authUser.deleteMany({ where: { id: authUserId } });
  await prisma.$disconnect();
});

describe('Sync idempotency', () => {
  it('should sync CSV and create raw records', async () => {
    await syncService.startSync(ctx, dataSourceId);

    const { total } = await rawRecordRepo.list({
      tenantId,
      dataSourceId,
      skip: 0,
      take: 100,
    });

    expect(total).toBe(3); // 3 rows in fixture
  });

  it('should upsert raw records into the canonical model', async () => {
    const customers = await customerRepo.list({ tenantId, skip: 0, take: 100 });
    expect(customers.total).toBe(3);
    expect(customers.items.map((c) => c.externalId).sort()).toEqual([
      'CUST001',
      'CUST002',
      'CUST003',
    ]);
    expect(customers.items.find((c) => c.externalId === 'CUST001')?.name).toBe('João Silva');
  });

  it('should report canonical counters on the sync job', async () => {
    const { items } = await syncJobRepo.list({ tenantId, dataSourceId, skip: 0, take: 10 });
    const job = items[0]!;
    expect(job.status).toBe('completed');
    expect(job.recordsRead).toBe(3);
    expect(job.recordsCreated + job.recordsUpdated).toBe(3);
    expect(job.recordsFailed).toBe(0);
  });

  it('should mark raw records as processed', async () => {
    const { items } = await rawRecordRepo.list({ tenantId, dataSourceId, skip: 0, take: 100 });
    expect(items.every((record) => record.processedAt !== null)).toBe(true);
  });

  it('should trigger the post-sync hook', () => {
    expect(pipelineCalls.length).toBeGreaterThan(0);
  });

  it('should be idempotent: running sync twice produces same raw record count', async () => {
    await syncService.startSync(ctx, dataSourceId);

    const { total } = await rawRecordRepo.list({
      tenantId,
      dataSourceId,
      skip: 0,
      take: 100,
    });

    // Still 3, no duplicates
    expect(total).toBe(3);

    // And no duplicated canonical rows either
    const customers = await customerRepo.list({ tenantId, skip: 0, take: 100 });
    expect(customers.total).toBe(3);
  });

  it('should create a DataQualityReport after sync', async () => {
    const { items } = await qualityRepo.list({
      tenantId,
      dataSourceId,
      skip: 0,
      take: 10,
    });

    expect(items.length).toBeGreaterThan(0);
    const report = items[0]!;
    expect(report.totalRecords).toBe(3);
    expect(report.validRecords).toBe(3);
    expect(report.invalidRecords).toBe(0);
  });

  it('should normalize sales with items, resolving references across data sources', async () => {
    await syncService.startSync(ctx, productSourceId);
    await syncService.startSync(ctx, sellerSourceId);
    await syncService.startSync(ctx, saleSourceId);

    const sales = await saleRepo.list({ tenantId, skip: 0, take: 100 });
    // 4 rows in the fixture, one pointing at an unknown customer (CUST999)
    expect(sales.total).toBe(3);

    const first = sales.items.find((sale) => sale.externalId === 'SALE001')!;
    expect(Number(first.totalAmount)).toBe(300);
    expect(first.sellerId).not.toBeNull();
    expect(first.items).toHaveLength(1);
    expect(Number(first.items[0]!.quantity)).toBe(2);

    const revenue = sales.items.reduce((sum, sale) => sum + Number(sale.totalAmount), 0);
    expect(revenue).toBe(830.5);
  });

  it('should record the unresolved reference in the DataQualityReport', async () => {
    const { items } = await qualityRepo.list({
      tenantId,
      dataSourceId: saleSourceId,
      skip: 0,
      take: 10,
    });
    const report = items[0]!;
    expect(report.invalidRecords).toBe(1);
    const errors = report.errors as Array<{ rule: string; count: number }>;
    expect(errors.some((error) => error.rule === 'sale_customer_not_found')).toBe(true);
  });

  it('should keep revenue stable when the sales sync runs twice', async () => {
    await syncService.startSync(ctx, saleSourceId);

    const sales = await saleRepo.list({ tenantId, skip: 0, take: 100 });
    expect(sales.total).toBe(3);
    const revenue = sales.items.reduce((sum, sale) => sum + Number(sale.totalAmount), 0);
    expect(revenue).toBe(830.5);
    // Items replaced, not appended
    expect(sales.items.every((sale) => sale.items.length === 1)).toBe(true);
  });

  it('should fail the sync with a classified error when the file is missing', async () => {
    const brokenId = await createCsvSource({
      name: 'CSV inexistente',
      filePath: fixture('does-not-exist.csv'),
      targetEntity: 'customer',
      fields: [{ source: 'external_id', target: 'external_id' }],
    });

    await syncService.startSync(ctx, brokenId);

    const { items } = await syncJobRepo.list({
      tenantId,
      dataSourceId: brokenId,
      skip: 0,
      take: 10,
    });
    const job = items[0]!;
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/^SYNC_ERROR: /);
    expect(job.error).not.toMatch(/at .*\.ts:/); // no stack trace

    const audit = await auditLogRepo.list({ tenantId, skip: 0, take: 50 });
    expect(audit.items.some((log) => log.action === 'SYNC_FAILED')).toBe(true);
  });

  it('should isolate data from another tenant', async () => {
    const otherTenantId = createId();
    await prisma.tenant.create({
      data: { id: otherTenantId, name: 'Other Tenant', slug: `other-${otherTenantId.slice(0, 8)}` },
    });

    const { total } = await rawRecordRepo.list({
      tenantId: otherTenantId,
      dataSourceId,
      skip: 0,
      take: 100,
    });

    expect(total).toBe(0);

    const customers = await customerRepo.list({ tenantId: otherTenantId, skip: 0, take: 100 });
    expect(customers.total).toBe(0);

    await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => undefined);
  });
});
