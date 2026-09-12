/**
 * Authorized WhatsApp numbers: tenant isolation, global uniqueness, membership
 * gate, phone normalization and soft-disable / reactivate.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  MembershipRepository,
  prisma,
  TenantRepository,
  UserRepository,
  WhatsappAuthorizedNumberRepository,
} from '@tactia/database';
import { AppError, ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { AuditLogService } from '../services/audit-log-service';
import { WhatsappAuthorizedNumberService } from '../services/whatsapp-authorized-number-service';

const SLUGS = ['wa-co-a', 'wa-co-b'];

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const numbers = new WhatsappAuthorizedNumberRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));
const service = new WhatsappAuthorizedNumberService(numbers, memberships, auditLogs);

let ownerCtx: RequestContext;
let memberCtx: RequestContext;
let otherCtx: RequestContext;
let ownerId: string;
let memberId: string;
let otherOwnerId: string;
let outsiderId: string;

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
  if (ids.length > 0) {
    await prisma.whatsappAuthorizedNumber.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  }
  const authUsers = await prisma.authUser.findMany({
    where: { email: { endsWith: '@wa-numbers.test' } },
  });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  if (ids.length > 0) await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function createUser(name: string) {
  const auth = await prisma.authUser.create({
    data: { id: createId(), name, email: `${name}@wa-numbers.test`, emailVerified: true },
  });
  return users.create({ externalAuthId: auth.id, name, email: `${name}@wa-numbers.test` });
}

describe('WhatsappAuthorizedNumberService', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanUp();
    const tenant = await tenants.create({ name: 'wa-a', slug: 'wa-co-a' });
    const other = await tenants.create({ name: 'wa-b', slug: 'wa-co-b' });
    const owner = await createUser('wa-owner');
    const member = await createUser('wa-member');
    const otherOwner = await createUser('wa-other');
    const outsider = await createUser('wa-outsider');
    await memberships.create({ tenantId: tenant.id, userId: owner.id, role: 'owner' });
    await memberships.create({ tenantId: tenant.id, userId: member.id, role: 'member' });
    await memberships.create({ tenantId: other.id, userId: otherOwner.id, role: 'owner' });
    ownerCtx = ctx(tenant.id, owner.id, 'owner');
    memberCtx = ctx(tenant.id, member.id, 'member');
    otherCtx = ctx(other.id, otherOwner.id, 'owner');
    ownerId = owner.id;
    memberId = member.id;
    otherOwnerId = otherOwner.id;
    outsiderId = outsider.id;
  });

  afterAll(async () => {
    await cleanUp();
    await prisma.$disconnect();
  });

  it('normalizes the phone and lists only the current tenant', async () => {
    const created = await service.create(ownerCtx, {
      userId: memberId,
      phone: '+55 11 98888-1111',
      label: 'Comercial',
    });
    expect(created.phone).toBe('5511988881111');
    expect(created.user.id).toBe(memberId);
    expect(created.label).toBe('Comercial');

    const mine = await service.list(ownerCtx);
    expect(mine.some((row) => row.id === created.id)).toBe(true);
    expect(await service.list(otherCtx)).toEqual([]);
  });

  it('rejects a number already active in this tenant and in another tenant', async () => {
    await service.create(ownerCtx, { userId: ownerId, phone: '5511988882222' });
    await expect(
      service.create(ownerCtx, { userId: memberId, phone: '5511988882222' }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    await expect(
      service.create(otherCtx, { userId: otherOwnerId, phone: '5511988882222' }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('rejects a user who is not an active member', async () => {
    await expect(
      service.create(ownerCtx, { userId: outsiderId, phone: '5511988883333' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('rejects members that are not admin', async () => {
    await expect(
      service.create(memberCtx, { userId: memberId, phone: '5511988884444' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('disables a number so inbound lookup misses it, then reactivates on create', async () => {
    const created = await service.create(ownerCtx, { userId: ownerId, phone: '5511988885555' });
    const disabled = await service.disable(ownerCtx, created.id);
    expect(disabled.disabledAt).toBeTruthy();
    expect(await service.findActiveByPhone('5511988885555')).toBeNull();

    const again = await service.create(ownerCtx, {
      userId: memberId,
      phone: '5511988885555',
      label: 'Celular',
    });
    expect(again.id).toBe(created.id);
    expect(again.disabledAt).toBeNull();
    expect(again.userId).toBe(memberId);
    expect(again.label).toBe('Celular');
    expect((await service.findActiveByPhone('5511988885555'))?.id).toBe(created.id);
  });

  it('updates the assigned user and rejects invalid phones', async () => {
    const created = await service.create(ownerCtx, { userId: ownerId, phone: '5511988886666' });
    const updated = await service.update(ownerCtx, created.id, { userId: memberId });
    expect(updated.userId).toBe(memberId);

    await expect(service.create(ownerCtx, { userId: ownerId, phone: '123' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
  });
});
