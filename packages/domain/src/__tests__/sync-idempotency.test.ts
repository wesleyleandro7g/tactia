import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  AuditLogRepository,
  CredentialRepository,
  DataQualityReportRepository,
  DataSourceRepository,
  ImportRepository,
  MappingRepository,
  prisma,
  RawRecordRepository,
  SyncJobRepository,
} from '@tactia/database';
import { createId, type RequestContext } from '@tactia/shared';
import { AuditLogService } from '../services/audit-log-service';
import { SyncService } from '../services/sync-service';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sample-customers.csv');

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

const syncService = new SyncService(
  dataSourceRepo,
  syncJobRepo,
  rawRecordRepo,
  importRepo,
  qualityRepo,
  mappingRepo,
  credentialRepo,
  auditLogs,
);

let tenantId: string;
let dataSourceId: string;
let ctx: RequestContext;
let authUserId: string;
let userId: string;

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

  // Create DataSource pointing to fixture CSV
  const ds = await dataSourceRepo.create({
    tenantId,
    type: 'csv',
    name: 'Sample CSV',
    configuration: { filePath: FIXTURE_PATH },
  });
  dataSourceId = ds.id;

  // Create Mapping: CSV data → customer
  await mappingRepo.create({
    tenantId,
    dataSourceId,
    sourceEntity: 'data',
    targetEntity: 'customer',
    configuration: {
      fields: [
        { source: 'external_id', target: 'external_id' },
        { source: 'name', target: 'name' },
        { source: 'email', target: 'email' },
        { source: 'phone', target: 'phone' },
      ],
    },
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

    await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => undefined);
  });
});
