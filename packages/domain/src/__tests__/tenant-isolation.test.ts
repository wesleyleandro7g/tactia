import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  MembershipRepository,
  prisma,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import { AppError, ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { AuditLogService } from '../services/audit-log-service';
import { MembershipService } from '../services/membership-service';
import { TenantService } from '../services/tenant-service';
import { UserService } from '../services/user-service';
import type { AuthProvider } from '../ports/auth-provider';

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));
const tenantService = new TenantService(tenants, memberships, auditLogs);

const authProvider: AuthProvider = {
  async createCredentialsUser(input) {
    const auth = await prisma.authUser.create({
      data: {
        id: createId(),
        name: input.name,
        email: input.email,
        emailVerified: true,
      },
    });
    await prisma.authAccount.create({
      data: {
        id: createId(),
        accountId: auth.id,
        providerId: 'credential',
        userId: auth.id,
        password: 'hashed',
      },
    });
    return { externalAuthId: auth.id };
  },
};

const userService = new UserService(users, memberships, auditLogs, authProvider);
const membershipService = new MembershipService(memberships, auditLogs);

async function reset() {
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.product.deleteMany();
  await prisma.seller.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.authAccount.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.authVerification.deleteMany();
  await prisma.authUser.deleteMany();
  await prisma.tenant.deleteMany();
}

function context(partial: Partial<RequestContext> & Pick<RequestContext, 'tenantId' | 'userId' | 'role'>): RequestContext {
  return {
    requestId: createId(),
    ip: '127.0.0.1',
    ...partial,
  };
}

describe('tenant isolation', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('does not leak tenant B data to a tenant A actor', async () => {
    const authA = await prisma.authUser.create({
      data: { id: createId(), name: 'Alice', email: 'alice@a.test', emailVerified: true },
    });
    const authB = await prisma.authUser.create({
      data: { id: createId(), name: 'Carol', email: 'carol@b.test', emailVerified: true },
    });
    const userA = await users.create({
      externalAuthId: authA.id,
      name: 'Alice',
      email: 'alice@a.test',
    });
    const userB = await users.create({
      externalAuthId: authB.id,
      name: 'Carol',
      email: 'carol@b.test',
    });

    const tenantA = await tenantService.create(context({ tenantId: null, userId: userA.id, role: null }), {
      name: 'Empresa A',
      slug: 'empresa-a',
    });
    const tenantB = await tenantService.create(context({ tenantId: null, userId: userB.id, role: null }), {
      name: 'Empresa B',
      slug: 'empresa-b',
    });

    const ctxA = context({ tenantId: tenantA.id, userId: userA.id, role: 'owner' });
    const ctxB = context({ tenantId: tenantB.id, userId: userB.id, role: 'owner' });

    await expect(userService.get(ctxA, userB.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await expect(tenantService.get(ctxA, tenantB.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });

    const listed = await userService.list(ctxA, { page: '1', pageSize: '20' });
    expect(listed.items.map((u) => u.id)).toEqual([userA.id]);
    expect(listed.items.map((u) => u.id)).not.toContain(userB.id);

    const bUsers = await userService.list(ctxB, { page: '1', pageSize: '20' });
    expect(bUsers.items.map((u) => u.id)).toEqual([userB.id]);

    const membershipsA = await membershipService.list(ctxA, { page: '1', pageSize: '20' });
    expect(membershipsA.items.every((m) => m.tenantId === tenantA.id)).toBe(true);

    const logsA = await auditLogs.list({
      tenantId: tenantA.id,
      skip: 0,
      take: 50,
    });
    expect(logsA.items.every((log) => log.tenantId === tenantA.id)).toBe(true);
    expect(logsA.items.some((log) => log.action === 'TENANT_CREATED')).toBe(true);
    expect(logsA.items.some((log) => log.action === 'MEMBERSHIP_CREATED')).toBe(true);

    const logsB = await auditLogs.list({ tenantId: tenantB.id, skip: 0, take: 50 });
    expect(logsB.items.every((log) => log.tenantId === tenantB.id)).toBe(true);
    expect(logsA.items.map((l) => l.id).some((id) => logsB.items.map((l) => l.id).includes(id))).toBe(
      false,
    );
  });

  it('returns AUTHORIZATION_ERROR when a viewer mutates memberships', async () => {
    const auth = await prisma.authUser.create({
      data: { id: createId(), name: 'View', email: 'view@a.test', emailVerified: true },
    });
    const ownerAuth = await prisma.authUser.create({
      data: { id: createId(), name: 'Owner', email: 'owner@a.test', emailVerified: true },
    });
    const owner = await users.create({
      externalAuthId: ownerAuth.id,
      name: 'Owner',
      email: 'owner@a.test',
    });
    const viewer = await users.create({
      externalAuthId: auth.id,
      name: 'View',
      email: 'view@a.test',
    });
    const tenant = await tenantService.create(context({ tenantId: null, userId: owner.id, role: null }), {
      name: 'Locked Co',
      slug: 'locked-co',
    });
    await memberships.create({ tenantId: tenant.id, userId: viewer.id, role: 'viewer' });

    const viewerCtx = context({ tenantId: tenant.id, userId: viewer.id, role: 'viewer' });
    await expect(
      membershipService.create(viewerCtx, { userId: viewer.id, role: 'member' }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      membershipService.create(viewerCtx, { userId: viewer.id, role: 'member' }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORIZATION_ERROR });
  });

  it('creates a company, users, and records USER_CREATED', async () => {
    const auth = await prisma.authUser.create({
      data: { id: createId(), name: 'Owner', email: 'owner@create.test', emailVerified: true },
    });
    const owner = await users.create({
      externalAuthId: auth.id,
      name: 'Owner',
      email: 'owner@create.test',
    });
    const ctxUser = context({ tenantId: null, userId: owner.id, role: null });
    const tenant = await tenantService.create(ctxUser, { name: 'Nova Empresa', slug: 'nova-empresa' });
    const ownerCtx = context({ tenantId: tenant.id, userId: owner.id, role: 'owner' });

    const created = await userService.create(ownerCtx, {
      name: 'Member',
      email: 'member@create.test',
      password: 'password123',
      role: 'member',
    });

    expect(created.user.email).toBe('member@create.test');
    const logs = await auditLogs.list({ tenantId: tenant.id, skip: 0, take: 50 });
    expect(logs.items.some((l) => l.action === 'USER_CREATED')).toBe(true);
    expect(logs.items.some((l) => l.action === 'TENANT_CREATED')).toBe(true);
    expect(logs.items.some((l) => l.action === 'MEMBERSHIP_CREATED')).toBe(true);
  });
});
