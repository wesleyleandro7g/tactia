/**
 * Etapa 17 — TenantApiKey create / list / revoke / verify.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  MembershipRepository,
  prisma,
  TenantApiKeyRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import { createId, type RequestContext } from '@tactia/shared';
import { AuditLogService } from '../services/audit-log-service';
import { TenantApiKeyService } from '../services/tenant-api-key-service';

const SLUGS = ['e17-keys-a', 'e17-keys-b'];

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const keys = new TenantApiKeyRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));
const service = new TenantApiKeyService(keys, auditLogs);

let ownerCtx: RequestContext;
let otherCtx: RequestContext;

function ctx(
  tenantId: string,
  userId: string,
  role: RequestContext['role'] = 'owner',
): RequestContext {
  return { requestId: createId(), tenantId, userId, role, ip: '127.0.0.1' };
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.tenantApiKey.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  const authUsers = await prisma.authUser.findMany({
    where: { email: { endsWith: '@e17-keys.test' } },
  });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function createUser(name: string) {
  const auth = await prisma.authUser.create({
    data: { id: createId(), name, email: `${name}@e17-keys.test`, emailVerified: true },
  });
  return users.create({ externalAuthId: auth.id, name, email: `${name}@e17-keys.test` });
}

describe('E17 TenantApiKey', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanUp();
    const tenant = await tenants.create({ name: 'e17-a', slug: 'e17-keys-a' });
    const other = await tenants.create({ name: 'e17-b', slug: 'e17-keys-b' });
    const owner = await createUser('e17-owner');
    const otherOwner = await createUser('e17-other');
    await memberships.create({ tenantId: tenant.id, userId: owner.id, role: 'owner' });
    await memberships.create({ tenantId: other.id, userId: otherOwner.id, role: 'owner' });
    ownerCtx = ctx(tenant.id, owner.id, 'owner');
    otherCtx = ctx(other.id, otherOwner.id, 'owner');
  });

  afterAll(async () => {
    await cleanUp();
    await prisma.$disconnect();
  });

  it('E17: create api key returns secret once; list does not include hash or secret', async () => {
    const created = await service.create(ownerCtx, { name: 'Claude Desktop' });
    expect(created.secret).toMatch(/^tactia_live_[a-f0-9]{8}_[a-f0-9]{64}$/);
    expect(created.prefix).toHaveLength(8);
    expect(created.scopes).toEqual(['tools:read']);
    expect(JSON.stringify(created)).not.toContain('"hash"');

    const listed = await service.list(ownerCtx);
    const row = listed.find((item) => item.id === created.id);
    expect(row).toBeTruthy();
    expect(JSON.stringify(listed)).not.toMatch(/"hash"/);
    expect(JSON.stringify(listed)).not.toContain(created.secret);
    expect(JSON.stringify(listed)).not.toContain('"secret"');
  });

  it('E17: revoke then Bearer 401', async () => {
    const created = await service.create(ownerCtx, { name: 'to-revoke' });
    const verified = await service.verify(created.secret);
    expect(verified?.keyId).toBe(created.id);

    await service.revoke(ownerCtx, created.id);
    expect(await service.verify(created.secret)).toBeNull();
  });

  it('E17: timing-safe verify rejects truncated token', async () => {
    const created = await service.create(ownerCtx, { name: 'truncated' });
    const truncated = created.secret.slice(0, 20);
    expect(truncated.length).toBeLessThan(created.secret.length);
    expect(await service.verify(truncated)).toBeNull();
    expect(await service.verify(created.secret.slice(0, -1))).toBeNull();
  });

  it('E17: CRON_SECRET is not accepted as Bearer on /api/v1/mcp', async () => {
    const previous = process.env['CRON_SECRET'];
    process.env['CRON_SECRET'] = 'platform-cron-secret';
    expect(await service.verify('platform-cron-secret')).toBeNull();
    expect(await service.verify(`Bearer platform-cron-secret`)).toBeNull();
    if (previous === undefined) delete process.env['CRON_SECRET'];
    else process.env['CRON_SECRET'] = previous;
  });

  it('does not leak neighbor tenant keys', async () => {
    const created = await service.create(ownerCtx, { name: 'mine' });
    const listed = await service.list(otherCtx);
    expect(listed.some((item) => item.id === created.id)).toBe(false);
  });

  it('verify returns null when the tenant is suspended', async () => {
    const created = await service.create(ownerCtx, { name: 'suspended-tenant' });
    expect(await service.verify(created.secret)).not.toBeNull();
    await prisma.tenant.update({
      where: { id: ownerCtx.tenantId! },
      data: { status: 'suspended' },
    });
    expect(await service.verify(created.secret)).toBeNull();
    await prisma.tenant.update({
      where: { id: ownerCtx.tenantId! },
      data: { status: 'active' },
    });
  });
});
