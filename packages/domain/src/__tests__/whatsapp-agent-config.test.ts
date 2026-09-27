/**
 * Per-company WhatsApp agent config: owner/admin gate, tenant isolation, and
 * idempotent upsert.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  prisma,
  TenantRepository,
  UserRepository,
  WhatsappAgentConfigRepository,
} from '@tactia/database';
import { AppError, createId, type RequestContext } from '@tactia/shared';
import { AuditLogService } from '../services/audit-log-service';
import { WhatsappAgentConfigService } from '../services/whatsapp-agent-config-service';

const SLUGS = ['wa-cfg-a', 'wa-cfg-b'];

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const configs = new WhatsappAgentConfigRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));
const service = new WhatsappAgentConfigService(configs, auditLogs);

let tenantAId: string;
let tenantBId: string;
let userId: string;

function ctx(
  tenantId: string,
  role: RequestContext['role'] = 'owner',
): RequestContext {
  return { requestId: createId(), tenantId, userId, role, ip: '127.0.0.1' };
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.whatsappAgentConfig.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }
  const authUsers = await prisma.authUser.findMany({
    where: { email: { endsWith: '@wa-cfg.test' } },
  });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
}

describe('WhatsappAgentConfigService', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanUp();
    const a = await tenants.create({ name: 'wa-cfg-a', slug: 'wa-cfg-a' });
    const b = await tenants.create({ name: 'wa-cfg-b', slug: 'wa-cfg-b' });
    tenantAId = a.id;
    tenantBId = b.id;
    const auth = await prisma.authUser.create({
      data: { id: createId(), name: 'wa-cfg-owner', email: 'owner@wa-cfg.test', emailVerified: true },
    });
    const user = await users.create({
      externalAuthId: auth.id,
      name: 'wa-cfg-owner',
      email: 'owner@wa-cfg.test',
    });
    userId = user.id;
  });

  afterAll(async () => {
    await cleanUp();
    await prisma.$disconnect();
  });

  it('upserts idempotently and reads back', async () => {
    const created = await service.upsert(ctx(tenantAId), {
      tone: 'Formal e objetivo',
      instructions: 'Sempre confirme antes de enviar e-mails.',
      companyContext: 'Loja de calçados com 3 filiais.',
    });
    expect(created.tone).toBe('Formal e objetivo');

    const updated = await service.upsert(ctx(tenantAId), { tone: 'Amigável' });
    expect(updated.id).toBe(created.id);
    expect(updated.tone).toBe('Amigável');
    // untouched fields persist
    expect(updated.companyContext).toBe('Loja de calçados com 3 filiais.');

    const fetched = await service.get(ctx(tenantAId));
    expect(fetched?.tone).toBe('Amigável');
  });

  it('isolates config per tenant', async () => {
    await service.upsert(ctx(tenantBId), { tone: 'Casual' });
    const a = await service.get(ctx(tenantAId));
    const b = await service.get(ctx(tenantBId));
    expect(a?.tone).toBe('Amigável');
    expect(b?.tone).toBe('Casual');
  });

  it('blocks non owner/admin roles', async () => {
    await expect(service.upsert(ctx(tenantAId, 'member'), { tone: 'X' })).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(service.get(ctx(tenantAId, 'member'))).rejects.toBeInstanceOf(AppError);
  });
});
