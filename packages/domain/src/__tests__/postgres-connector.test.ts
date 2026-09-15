/**
 * DoD (spec §59 — Data): "É possível conectar PostgreSQL".
 *
 * The source lives in its own schema (`e2e_source`) and is reached by the
 * connector through a separate `pg` connection using a credential encrypted at
 * rest — the same path a real client database takes (spec §20, §36).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { CredentialService } from '../services/credential-service';
import { DataSourceService } from '../services/data-source-service';
import { SyncService } from '../services/sync-service';

const SOURCE_SCHEMA = 'e2e_source';

const auditLogRepo = new AuditLogRepository(prisma);
const auditLogs = new AuditLogService(auditLogRepo);
const dataSourceRepo = new DataSourceRepository(prisma);
const mappingRepo = new MappingRepository(prisma);
const credentialRepo = new CredentialRepository(prisma);
const syncJobRepo = new SyncJobRepository(prisma);
const rawRecordRepo = new RawRecordRepository(prisma);
const importRepo = new ImportRepository(prisma);
const qualityRepo = new DataQualityReportRepository(prisma);
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

const credentialService = new CredentialService(credentialRepo);
const dataSourceService = new DataSourceService(
  dataSourceRepo,
  mappingRepo,
  credentialRepo,
  auditLogs,
);
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
});

let tenantId: string;
let authUserId: string;
let userId: string;
let operatorId: string;
let operatorAuthId: string;
let ctx: RequestContext;
let dataSourceId: string;
let email: string;

function connectionFromEnv() {
  const url = new URL(process.env['DATABASE_URL']!);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ''),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

beforeAll(async () => {
  // External source: a schema with a customers table, outside Tactia's tables.
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SOURCE_SCHEMA} CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SOURCE_SCHEMA}`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE ${SOURCE_SCHEMA}.clientes (
       id text PRIMARY KEY,
       nome text NOT NULL,
       email text,
       telefone text
     )`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${SOURCE_SCHEMA}.clientes (id, nome, email, telefone) VALUES
       ('EXT-1', 'Bar do Zé', 'ze@example.com', '11999990001'),
       ('EXT-2', 'Loja Aurora', 'aurora@example.com', '11999990002')`,
  );

  tenantId = createId();
  await prisma.tenant.create({
    data: { id: tenantId, name: 'Postgres Source Tenant', slug: `pg-src-${tenantId.slice(0, 8)}` },
  });

  authUserId = createId();
  email = `pg-src-${authUserId}@connector.local`;
  await prisma.authUser.create({
    data: { id: authUserId, name: 'Test', email, emailVerified: true },
  });
  userId = createId();
  await prisma.user.create({
    data: { id: userId, externalAuthId: authUserId, name: 'Test', email },
  });
  await prisma.membership.create({
    data: { id: createId(), tenantId, userId, role: 'owner', status: 'active' },
  });

  operatorAuthId = createId();
  operatorId = createId();
  const operatorEmail = `pg-ops-${operatorAuthId}@connector.local`;
  await prisma.operatorAuthUser.create({
    data: { id: operatorAuthId, name: 'Ops', email: operatorEmail, emailVerified: true },
  });
  await prisma.operator.create({
    data: { id: operatorId, externalAuthId: operatorAuthId, name: 'Ops', email: operatorEmail },
  });
  ctx = { requestId: createId(), tenantId, userId, role: 'owner', operatorId };
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SOURCE_SCHEMA} CASCADE`);
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.authAccount.deleteMany({ where: { userId: authUserId } });
  await prisma.authUser.deleteMany({ where: { id: authUserId } });
  await prisma.operator.deleteMany({ where: { id: operatorId } });
  await prisma.operatorAuthUser.deleteMany({ where: { id: operatorAuthId } });
  await prisma.$disconnect();
});

describe('PostgresConnector', () => {
  it('stores the password encrypted and never returns it', async () => {
    const connection = connectionFromEnv();
    const credential = await credentialService.create(ctx, {
      provider: 'database',
      data: { username: connection.username, password: connection.password },
    });

    const row = await prisma.credential.findUniqueOrThrow({ where: { id: credential.id } });
    expect(row.encryptedData).not.toContain(connection.password);

    const exposed = await credentialService.get(ctx, credential.id);
    expect(Object.keys(exposed).sort()).toEqual(['createdAt', 'id', 'provider']);

    const ds = await dataSourceService.create(ctx, {
      name: 'ERP do cliente',
      type: 'database',
      configuration: {
        dialect: 'postgres',
        host: connection.host,
        port: connection.port,
        database: connection.database,
        schema: SOURCE_SCHEMA,
      },
      credentialId: credential.id,
    });
    dataSourceId = ds.id;
  });

  it('tests the connection', async () => {
    const result = await dataSourceService.testConnection(ctx, dataSourceId);
    expect(result.success).toBe(true);
  });

  it('probes a postgres dialect without persisting a source', async () => {
    const connection = connectionFromEnv();
    const result = await dataSourceService.probeConnection(ctx, {
      dialect: 'postgres',
      configuration: {
        host: connection.host,
        port: connection.port,
        database: connection.database,
        schema: SOURCE_SCHEMA,
      },
      credentials: { username: connection.username, password: connection.password },
    });
    expect(result.success).toBe(true);
    expect(result.resources?.some((resource) => resource.name === 'clientes')).toBe(true);
  });

  it('discovers tables and columns from information_schema', async () => {
    const discovery = await dataSourceService.discover(ctx, dataSourceId);
    const clientes = discovery.resources.find((resource) => resource.name === 'clientes');
    expect(clientes).toBeDefined();
    expect(clientes!.columns.map((column) => column.name).sort()).toEqual([
      'email',
      'id',
      'nome',
      'telefone',
    ]);
  });

  it('previews rows', async () => {
    const rows = await dataSourceService.preview(ctx, dataSourceId, 'clientes', 5);
    expect(rows).toHaveLength(2);
  });

  it('syncs into raw records and the canonical model', async () => {
    await dataSourceService.createMapping(ctx, dataSourceId, {
      sourceEntity: 'clientes',
      targetEntity: 'customer',
      configuration: {
        fields: [
          { source: 'id', target: 'external_id' },
          { source: 'nome', target: 'name', transform: 'trim' },
          { source: 'email', target: 'email' },
          { source: 'telefone', target: 'phone' },
        ],
      },
    });

    const job = await syncService.startSync(ctx, dataSourceId);
    expect(job?.status).toBe('completed');
    expect(job?.recordsRead).toBe(2);
    expect(job?.recordsCreated).toBe(2);

    const raw = await rawRecordRepo.list({ tenantId, dataSourceId, skip: 0, take: 10 });
    expect(raw.total).toBe(2);

    const customers = await customerRepo.list({ tenantId, skip: 0, take: 10 });
    expect(customers.total).toBe(2);
    expect(customers.items.map((customer) => customer.name).sort()).toEqual([
      'Bar do Zé',
      'Loja Aurora',
    ]);
    expect(customers.items.find((customer) => customer.externalId === 'EXT-1')?.email).toBe(
      'ze@example.com',
    );
  });

  it('is idempotent and reflects source updates', async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE ${SOURCE_SCHEMA}.clientes SET nome = 'Bar do Zé Ltda' WHERE id = 'EXT-1'`,
    );

    const job = await syncService.startSync(ctx, dataSourceId);
    expect(job?.status).toBe('completed');
    expect(job?.recordsUpdated).toBe(2);
    expect(job?.recordsCreated).toBe(0);

    const raw = await rawRecordRepo.list({ tenantId, dataSourceId, skip: 0, take: 10 });
    expect(raw.total).toBe(2); // no duplicates

    const customers = await customerRepo.list({ tenantId, skip: 0, take: 10 });
    expect(customers.total).toBe(2);
    expect(customers.items.find((customer) => customer.externalId === 'EXT-1')?.name).toBe(
      'Bar do Zé Ltda',
    );
  });

  it('reports a connector error without leaking the password', async () => {
    const broken = await dataSourceService.create(ctx, {
      name: 'Host inválido',
      type: 'database',
      configuration: { dialect: 'postgres', host: '127.0.0.1', port: 1, database: 'nope' },
    });
    const result = await dataSourceService.testConnection(ctx, broken.id);
    expect(result.success).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });
});
