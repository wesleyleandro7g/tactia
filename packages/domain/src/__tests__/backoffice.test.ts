/**
 * Backoffice operators: dedicated identity, tenant provisioning, suspend,
 * password reset, and operator lifecycle.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  CredentialRepository,
  DataSourceRepository,
  ImportRepository,
  InsightRepository,
  MappingRepository,
  MembershipRepository,
  OperatorRepository,
  prisma,
  SyncJobRepository,
  TenantApiKeyRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import { AppError, ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { AuditLogService } from '../services/audit-log-service';
import { BackofficeService } from '../services/backoffice-service';
import { CredentialService } from '../services/credential-service';
import { DataSourceService } from '../services/data-source-service';
import { OperatorService } from '../services/operator-service';
import { TenantApiKeyService } from '../services/tenant-api-key-service';
import { TenantService } from '../services/tenant-service';
import type { AuthProvider } from '../ports/auth-provider';
import type { SyncService } from '../services/sync-service';
import { assertOperator } from '../authz';

const SLUG = 'ops-co';
const OPERATOR_EMAIL = 'ops@backoffice.test';
const OWNER_EMAIL = 'owner@ops-co.test';
const MEMBER_EMAIL = 'member@ops-co.test';
const SECOND_OPS_EMAIL = 'second@backoffice.test';

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const operators = new OperatorRepository(prisma);
const dataSources = new DataSourceRepository(prisma);
const syncJobs = new SyncJobRepository(prisma);
const imports = new ImportRepository(prisma);
const insights = new InsightRepository(prisma);
const auditLogRepo = new AuditLogRepository(prisma);
const auditLogs = new AuditLogService(auditLogRepo);
const keys = new TenantApiKeyRepository(prisma);
const apiKeys = new TenantApiKeyService(keys, auditLogs);
const tenantService = new TenantService(tenants, memberships, auditLogs);

const clientAuth: AuthProvider = {
  async createCredentialsUser(input) {
    const id = createId();
    await prisma.authUser.create({
      data: { id, name: input.name, email: input.email, emailVerified: true },
    });
    await prisma.authAccount.create({
      data: {
        id: createId(),
        issuer: 'credential',
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: `hash:${input.password}`,
      },
    });
    return { externalAuthId: id };
  },
  async setPassword(externalAuthId, password) {
    await prisma.authAccount.updateMany({
      where: { userId: externalAuthId, providerId: 'credential' },
      data: { password: `hash:${password}` },
    });
  },
};

const operatorAuth: AuthProvider = {
  async createCredentialsUser(input) {
    const id = createId();
    await prisma.operatorAuthUser.create({
      data: { id, name: input.name, email: input.email, emailVerified: true },
    });
    await prisma.operatorAuthAccount.create({
      data: {
        id: createId(),
        issuer: 'credential',
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: `hash:${input.password}`,
      },
    });
    return { externalAuthId: id };
  },
  async setPassword(externalAuthId, password) {
    await prisma.operatorAuthAccount.updateMany({
      where: { userId: externalAuthId, providerId: 'credential' },
      data: { password: `hash:${password}` },
    });
  },
};

const operatorService = new OperatorService(operators, operatorAuth);

const syncService = {
  async startSync(ctx: RequestContext, dataSourceId: string) {
    await auditLogs.record(ctx, {
      action: 'SYNC_STARTED',
      entityType: 'data_source',
      entityId: dataSourceId,
    });
    return { id: createId(), status: 'pending' as const };
  },
} as unknown as SyncService;

const mappingRepo = new MappingRepository(prisma);
const credentialRepo = new CredentialRepository(prisma);
const dataSourceService = new DataSourceService(dataSources, mappingRepo, credentialRepo, auditLogs);
const credentialService = new CredentialService(credentialRepo);

const backoffice = new BackofficeService(
  tenants,
  users,
  memberships,
  dataSources,
  syncJobs,
  imports,
  insights,
  auditLogs,
  auditLogRepo,
  clientAuth,
  syncService,
  dataSourceService,
  credentialService,
);

function operatorCtx(operatorId: string): RequestContext {
  return {
    requestId: createId(),
    tenantId: null,
    userId: null,
    role: null,
    operatorId,
    ip: '127.0.0.1',
  };
}

async function cleanUp() {
  const tenantRows = await prisma.tenant.findMany({ where: { slug: SLUG } });
  const tenantIds = tenantRows.map((row) => row.id);
  if (tenantIds.length > 0) {
    await prisma.tenantApiKey.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.dataSource.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
  }

  const domainUsers = await prisma.user.findMany({
    where: { email: { in: [OWNER_EMAIL, MEMBER_EMAIL] } },
  });
  const authIds = domainUsers.map((row) => row.externalAuthId);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authAccount.deleteMany({ where: { userId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }

  if (tenantIds.length > 0) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });

  const ops = await prisma.operator.findMany({
    where: { email: { in: [OPERATOR_EMAIL, SECOND_OPS_EMAIL] } },
  });
  const opAuthIds = ops.map((row) => row.externalAuthId);
  if (ops.length > 0) {
    await prisma.auditLog.updateMany({
      where: { operatorId: { in: ops.map((row) => row.id) } },
      data: { operatorId: null },
    });
    await prisma.operator.deleteMany({ where: { id: { in: ops.map((row) => row.id) } } });
  }
  if (opAuthIds.length > 0) {
    await prisma.operatorAuthAccount.deleteMany({ where: { userId: { in: opAuthIds } } });
    await prisma.operatorAuthUser.deleteMany({ where: { id: { in: opAuthIds } } });
  }
}

describe('backoffice operators', () => {
  let ops: { id: string };

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanUp();
    ops = await operatorService.bootstrap({
      name: 'Ops',
      email: OPERATOR_EMAIL,
      password: 'operator-pass-1',
    });
  });

  afterAll(async () => {
    await cleanUp();
    await prisma.$disconnect();
  });

  it('bootstrap is idempotent on email', async () => {
    const again = await operatorService.bootstrap({
      name: 'Ops',
      email: OPERATOR_EMAIL,
      password: 'other-pass-999',
    });
    expect(again.id).toBe(ops.id);
  });

  it('client auth user is not an operator', async () => {
    const ctx = operatorCtx(ops.id);
    const provisioned = await backoffice.provisionTenant(ctx, {
      name: 'Ops Co',
      slug: SLUG,
      ownerName: 'Owner',
      ownerEmail: OWNER_EMAIL,
      ownerPassword: 'password123',
    });
    const operatorByClientAuth = await operators.findByExternalAuthId(
      provisioned.user.externalAuthId,
    );
    expect(operatorByClientAuth).toBeNull();
    expect(() => assertOperator({ ...ctx, operatorId: null })).toThrow(AppError);
  });

  it('provisions a tenant + owner that belongs to client auth tables', async () => {
    const ctx = operatorCtx(ops.id);
    const result = await backoffice.provisionTenant(ctx, {
      name: 'Ops Co',
      slug: SLUG,
      ownerName: 'Owner',
      ownerEmail: OWNER_EMAIL,
      ownerPassword: 'password123',
    });

    expect(result.tenant.slug).toBe(SLUG);
    expect(result.membership.role).toBe('owner');

    const account = await prisma.authAccount.findFirst({
      where: { userId: result.user.externalAuthId },
    });
    expect(account?.password).toBe('hash:password123');

    const operatorAccount = await prisma.operatorAuthAccount.findFirst({
      where: { userId: result.user.externalAuthId },
    });
    expect(operatorAccount).toBeNull();

    const listed = await tenantService.listForUser({
      requestId: createId(),
      tenantId: null,
      userId: result.user.id,
      role: null,
    });
    expect(listed.map((row) => row.id)).toEqual([result.tenant.id]);

    const logs = await auditLogRepo.list({ tenantId: result.tenant.id, skip: 0, take: 20 });
    expect(logs.items.every((row) => row.operatorId === ops.id)).toBe(true);
    expect(logs.items.every((row) => row.actorType === 'operator')).toBe(true);
    expect(logs.items.every((row) => row.userId === null)).toBe(true);
  });

  it('suspends a tenant so membership and API keys stop working', async () => {
    const ctx = operatorCtx(ops.id);
    const { tenant, user } = await backoffice.provisionTenant(ctx, {
      name: 'Ops Co',
      slug: SLUG,
      ownerName: 'Owner',
      ownerEmail: OWNER_EMAIL,
      ownerPassword: 'password123',
    });

    const ownerCtx: RequestContext = {
      requestId: createId(),
      tenantId: tenant.id,
      userId: user.id,
      role: 'owner',
      ip: '127.0.0.1',
    };
    const created = await apiKeys.create(ownerCtx, { name: 'mcp' });

    await backoffice.updateTenant(ctx, tenant.id, { status: 'suspended' });

    const membership = await tenantService.resolveActiveMembership(user.id, tenant.id);
    expect(membership).toBeNull();
    expect(await apiKeys.verify(created.secret)).toBeNull();

    await backoffice.updateTenant(ctx, tenant.id, { status: 'active' });
    const restored = await tenantService.resolveActiveMembership(user.id, tenant.id);
    expect(restored?.tenantId).toBe(tenant.id);
    expect(await apiKeys.verify(created.secret)).not.toBeNull();
  });

  it('resets a client password on auth_accounts', async () => {
    const ctx = operatorCtx(ops.id);
    const { tenant, user } = await backoffice.provisionTenant(ctx, {
      name: 'Ops Co',
      slug: SLUG,
      ownerName: 'Owner',
      ownerEmail: OWNER_EMAIL,
      ownerPassword: 'password123',
    });

    await backoffice.resetPassword(ctx, tenant.id, user.id, { password: 'new-secret-99' });
    const account = await prisma.authAccount.findFirst({
      where: { userId: user.externalAuthId },
    });
    expect(account?.password).toBe('hash:new-secret-99');
  });

  it('records operatorId on a triggered sync', async () => {
    const ctx = operatorCtx(ops.id);
    const { tenant } = await backoffice.provisionTenant(ctx, {
      name: 'Ops Co',
      slug: SLUG,
      ownerName: 'Owner',
      ownerEmail: OWNER_EMAIL,
      ownerPassword: 'password123',
    });
    const source = await dataSources.create({
      tenantId: tenant.id,
      type: 'csv',
      name: 'Vendas',
    });

    await backoffice.triggerSync(ctx, tenant.id, source.id);
    const logs = await auditLogRepo.list({ tenantId: tenant.id, skip: 0, take: 50 });
    const syncLog = logs.items.find((row) => row.action === 'SYNC_STARTED');
    expect(syncLog?.operatorId).toBe(ops.id);
    expect(syncLog?.actorType).toBe('operator');
  });

  it('cannot disable the last active operator or self', async () => {
    const ctx = operatorCtx(ops.id);
    await expect(operatorService.disable(ctx, ops.id)).rejects.toMatchObject({
      code: ErrorCode.AUTHORIZATION_ERROR,
    });

    const second = await operatorService.create(ctx, {
      name: 'Second',
      email: SECOND_OPS_EMAIL,
      password: 'operator-pass-2',
    });
    await operatorService.disable(ctx, second.id);
    const disabled = await operators.findById(second.id);
    expect(disabled?.status).toBe('disabled');

    await expect(operatorService.disable(ctx, ops.id)).rejects.toMatchObject({
      code: ErrorCode.AUTHORIZATION_ERROR,
    });
  });

  it('adds a member to a provisioned tenant', async () => {
    const ctx = operatorCtx(ops.id);
    const { tenant } = await backoffice.provisionTenant(ctx, {
      name: 'Ops Co',
      slug: SLUG,
      ownerName: 'Owner',
      ownerEmail: OWNER_EMAIL,
      ownerPassword: 'password123',
    });
    const added = await backoffice.addUser(ctx, tenant.id, {
      name: 'Member',
      email: MEMBER_EMAIL,
      password: 'password123',
      role: 'member',
    });
    expect(added.membership.role).toBe('member');
    expect(added.user.email).toBe(MEMBER_EMAIL);
  });

  it('operator registers a source; the client owner cannot', async () => {
    const ctx = operatorCtx(ops.id);
    const { tenant, user } = await backoffice.provisionTenant(ctx, {
      name: 'Ops Co',
      slug: SLUG,
      ownerName: 'Owner',
      ownerEmail: OWNER_EMAIL,
      ownerPassword: 'password123',
    });

    const source = await backoffice.createDataSource(ctx, tenant.id, {
      name: 'Wiki comercial',
      type: 'notion',
      configuration: { databaseId: 'db-1' },
    });
    expect(source.type).toBe('notion');
    expect(source.name).toBe('Wiki comercial');

    const ownerCtx: RequestContext = {
      requestId: createId(),
      tenantId: tenant.id,
      userId: user.id,
      role: 'owner',
      ip: '127.0.0.1',
    };
    await expect(
      dataSourceService.create(ownerCtx, { name: 'CSV do cliente', type: 'csv' }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORIZATION_ERROR });

    await expect(
      backoffice.createDataSource(ctx, tenant.id, { name: 'Desconhecida', type: 'salesforce' }),
    ).rejects.toThrow();
  });

  it('builds the tenant header with tab indicators', async () => {
    const ctx = operatorCtx(ops.id);
    const { tenant } = await backoffice.provisionTenant(ctx, {
      name: 'Ops Co',
      slug: SLUG,
      ownerName: 'Owner',
      ownerEmail: OWNER_EMAIL,
      ownerPassword: 'password123',
    });
    await backoffice.addUser(ctx, tenant.id, {
      name: 'Member',
      email: MEMBER_EMAIL,
      password: 'password123',
      role: 'member',
    });

    const empty = await backoffice.getTenantHeader(ctx, tenant.id);
    expect(empty.tenant.id).toBe(tenant.id);
    expect(empty.indicators).toEqual({ users: 2, dataSources: 0, sync: null });

    const source = await dataSources.create({ tenantId: tenant.id, type: 'csv', name: 'Vendas' });
    const failed = await syncJobs.create({ tenantId: tenant.id, dataSourceId: source.id, status: 'failed' });
    const afterFailure = await backoffice.getTenantHeader(ctx, tenant.id);
    expect(afterFailure.indicators).toEqual({ users: 2, dataSources: 1, sync: 'failed' });

    await syncJobs.create({ tenantId: tenant.id, dataSourceId: source.id, status: 'running' });
    expect((await backoffice.getTenantHeader(ctx, tenant.id)).indicators.sync).toBe('running');

    await prisma.syncJob.deleteMany({ where: { tenantId: tenant.id, id: { not: failed.id } } });
    await syncJobs.create({ tenantId: tenant.id, dataSourceId: source.id, status: 'completed' });
    expect((await backoffice.getTenantHeader(ctx, tenant.id)).indicators.sync).toBeNull();
  });

  it('serves per-tab data and keeps getTenant shape', async () => {
    const ctx = operatorCtx(ops.id);
    const { tenant } = await backoffice.provisionTenant(ctx, {
      name: 'Ops Co',
      slug: SLUG,
      ownerName: 'Owner',
      ownerEmail: OWNER_EMAIL,
      ownerPassword: 'password123',
    });
    const source = await dataSources.create({ tenantId: tenant.id, type: 'csv', name: 'Vendas' });
    await syncJobs.create({ tenantId: tenant.id, dataSourceId: source.id });

    const users = await backoffice.listTenantUsers(ctx, tenant.id);
    expect(users.map((row) => row.user.email)).toEqual([OWNER_EMAIL]);
    const sources = await backoffice.listTenantDataSources(ctx, tenant.id);
    expect(sources.map((row) => row.id)).toEqual([source.id]);
    const history = await backoffice.getTenantSyncHistory(ctx, tenant.id);
    expect(history.syncJobs).toHaveLength(1);
    expect(history.imports).toEqual([]);
    const activity = await backoffice.getTenantActivity(ctx, tenant.id);
    expect(activity.auditLogs.length).toBeGreaterThan(0);
    expect(activity.insights).toEqual([]);

    const detail = await backoffice.getTenant(ctx, tenant.id);
    expect(Object.keys(detail).sort()).toEqual(
      ['auditLogs', 'dataSources', 'imports', 'insights', 'syncJobs', 'tenant', 'users'],
    );
  });

  it('per-tab methods reject unknown tenants and non-operators', async () => {
    const ctx = operatorCtx(ops.id);
    const missing = createId();
    await expect(backoffice.getTenantHeader(ctx, missing)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await expect(backoffice.listTenantUsers(ctx, missing)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await expect(
      backoffice.getTenantActivity({ ...ctx, operatorId: null }, missing),
    ).rejects.toBeInstanceOf(AppError);
  });
});
