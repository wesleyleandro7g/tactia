/**
 * Admin settings routes (WhatsApp, API keys, connections, documents, playbooks)
 * against a real Postgres. `createApiHandler` is replaced by a pass-through so
 * an operator session can be injected; everything below (tenant scoping, domain
 * services, audit) is production code.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.LLM_PROVIDER = 'mock';
  process.env.JOBS_ENABLED = 'false';
});

vi.mock('@/lib/api', () => ({
  createApiHandler: (
    _options: { auth: string },
    handler: (request: Request, ctx: unknown, params: Record<string, string>) => unknown,
  ) => handler,
  readJson: (request: Request) => request.json(),
  searchParamsRecord: (request: Request) =>
    Object.fromEntries(new URL(request.url).searchParams.entries()),
}));

import { prisma, TenantRepository, UserRepository, MembershipRepository } from '@tactia/database';
import { AppError, ErrorCode, createId, type RequestContext } from '@tactia/shared';
import {
  GET as apiKeysGet,
  POST as apiKeysPost,
} from '@/app/api/v1/tenants/[id]/api-keys/route';
import { POST as apiKeyRevoke } from '@/app/api/v1/tenants/[id]/api-keys/[keyId]/revoke/route';
import {
  GET as whatsappGet,
  POST as whatsappPost,
} from '@/app/api/v1/tenants/[id]/whatsapp/numbers/route';
import { DELETE as whatsappDelete } from '@/app/api/v1/tenants/[id]/whatsapp/numbers/[numberId]/route';
import {
  GET as playbooksGet,
  POST as playbooksPost,
} from '@/app/api/v1/tenants/[id]/playbooks/route';
import { DELETE as playbookDelete } from '@/app/api/v1/tenants/[id]/playbooks/[playbookId]/route';

type Handler = (request: Request, ctx: RequestContext, params: Record<string, string>) => Promise<unknown>;
const call = (handler: unknown) => handler as Handler;

const SLUGS = ['admin-settings-co', 'admin-settings-other'];
let tenantId: string;
let otherTenantId: string;
let operatorId: string;
let operatorAuthId: string;
let ownerUserId: string;
let ownerAuthId: string;

function operatorSession(): RequestContext {
  return { requestId: createId(), tenantId: null, userId: null, role: null, operatorId, ip: null };
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.tenantApiKey.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.whatsappAuthorizedNumber.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.playbook.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();
  const tenants = new TenantRepository(prisma);
  const users = new UserRepository(prisma);
  const memberships = new MembershipRepository(prisma);
  tenantId = (await tenants.create({ name: 'Admin Settings Co', slug: SLUGS[0]! })).id;
  otherTenantId = (await tenants.create({ name: 'Other Settings Co', slug: SLUGS[1]! })).id;

  ownerAuthId = createId();
  await prisma.authUser.create({
    data: { id: ownerAuthId, name: 'Owner', email: `owner-${ownerAuthId}@settings.local`, emailVerified: true },
  });
  const owner = await users.create({
    externalAuthId: ownerAuthId,
    name: 'Owner',
    email: `owner-${ownerAuthId}@settings.local`,
  });
  ownerUserId = owner.id;
  await memberships.create({ tenantId, userId: ownerUserId, role: 'owner', status: 'active' });

  operatorAuthId = createId();
  await prisma.operatorAuthUser.create({
    data: { id: operatorAuthId, name: 'ops', email: `ops-${operatorAuthId}@settings.local`, emailVerified: true },
  });
  operatorId = (
    await prisma.operator.create({
      data: { id: createId(), externalAuthId: operatorAuthId, name: 'ops', email: `ops-${operatorAuthId}@settings.local` },
    })
  ).id;
});

afterAll(async () => {
  await cleanUp();
  await prisma.auditLog.deleteMany({ where: { operatorId } });
  await prisma.operator.deleteMany({ where: { id: operatorId } });
  await prisma.operatorAuthUser.deleteMany({ where: { id: operatorAuthId } });
  await prisma.user.deleteMany({ where: { id: ownerUserId } });
  await prisma.authUser.deleteMany({ where: { id: ownerAuthId } });
  await prisma.$disconnect();
});

describe('admin API keys', () => {
  it('issues a key for a tenant owner and audits the operator', async () => {
    const created = (await call(apiKeysPost)(
      jsonRequest({ name: 'Claude Desktop', userId: ownerUserId, scopes: ['tools:read'] }),
      operatorSession(),
      { id: tenantId },
    )) as { id: string; secret: string; prefix: string };
    expect(created.secret).toMatch(/^tactia_live_/);

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId, action: 'API_KEY_CREATED' },
    });
    // The key is attributed to the chosen owner while the operator keeps the trail.
    expect(audit).toMatchObject({ operatorId, userId: ownerUserId, actorType: 'operator' });

    const listed = (await call(apiKeysGet)(new Request('http://localhost/api'), operatorSession(), {
      id: tenantId,
    })) as { keys: Array<{ id: string }>; owners: Array<{ id: string }> };
    expect(listed.keys.map((key) => key.id)).toContain(created.id);
    expect(listed.owners.map((owner) => owner.id)).toContain(ownerUserId);

    const revoked = (await call(apiKeyRevoke)(new Request('http://localhost/api'), operatorSession(), {
      id: tenantId,
      keyId: created.id,
    })) as { revokedAt: string | null };
    expect(revoked.revokedAt).toBeTruthy();
  });

  it('rejects a key owner from another tenant', async () => {
    await expect(
      call(apiKeysPost)(
        jsonRequest({ name: 'Bad', userId: ownerUserId }),
        operatorSession(),
        { id: otherTenantId },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('hides unknown tenants', async () => {
    await expect(
      call(apiKeysGet)(new Request('http://localhost/api'), operatorSession(), { id: createId() }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe('admin WhatsApp numbers', () => {
  it('authorizes and disables a number tied to a tenant user', async () => {
    const created = (await call(whatsappPost)(
      jsonRequest({ phone: '5511999990000', userId: ownerUserId, label: 'Owner' }),
      operatorSession(),
      { id: tenantId },
    )) as { id: string; phone: string };
    expect(created.phone).toBe('5511999990000');

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId, action: 'WHATSAPP_NUMBER_CREATED' },
    });
    expect(audit).toMatchObject({ operatorId, actorType: 'operator' });

    const listed = (await call(whatsappGet)(new Request('http://localhost/api'), operatorSession(), {
      id: tenantId,
    })) as { numbers: Array<{ id: string }>; users: Array<{ id: string }> };
    expect(listed.numbers.map((row) => row.id)).toContain(created.id);
    expect(listed.users.map((user) => user.id)).toContain(ownerUserId);

    const disabled = (await call(whatsappDelete)(new Request('http://localhost/api'), operatorSession(), {
      id: tenantId,
      numberId: created.id,
    })) as { disabledAt: Date | null };
    expect(disabled.disabledAt).toBeTruthy();
  });

  it('cannot disable a number from another tenant', async () => {
    const created = (await call(whatsappPost)(
      jsonRequest({ phone: '5511988880000', userId: ownerUserId }),
      operatorSession(),
      { id: tenantId },
    )) as { id: string };
    await expect(
      call(whatsappDelete)(new Request('http://localhost/api'), operatorSession(), {
        id: otherTenantId,
        numberId: created.id,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe('admin playbooks', () => {
  it('creates, lists and removes a playbook with operator audit', async () => {
    const created = (await call(playbooksPost)(
      jsonRequest({
        slug: 'onboarding',
        title: 'Onboarding',
        trigger: 'Novo cliente',
        steps: [{ ordinal: 1, text: 'Enviar boas-vindas' }],
        enabled: true,
      }),
      operatorSession(),
      { id: tenantId },
    )) as { id: string; slug: string };
    expect(created.slug).toBe('onboarding');

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId, action: 'PLAYBOOK_CREATED' },
    });
    expect(audit).toMatchObject({ operatorId, actorType: 'operator' });

    const listed = (await call(playbooksGet)(new Request('http://localhost/api'), operatorSession(), {
      id: tenantId,
    })) as { items: Array<{ id: string }> };
    expect(listed.items.map((item) => item.id)).toContain(created.id);

    await call(playbookDelete)(new Request('http://localhost/api'), operatorSession(), {
      id: tenantId,
      playbookId: created.id,
    });
    const after = (await call(playbooksGet)(new Request('http://localhost/api'), operatorSession(), {
      id: tenantId,
    })) as { items: Array<{ id: string }> };
    expect(after.items.map((item) => item.id)).not.toContain(created.id);
  });

  it('cannot remove a playbook from another tenant', async () => {
    const created = (await call(playbooksPost)(
      jsonRequest({
        slug: 'shared-slug',
        title: 'Shared',
        trigger: 'x',
        steps: [{ ordinal: 1, text: 'passo' }],
        enabled: true,
      }),
      operatorSession(),
      { id: tenantId },
    )) as { id: string };
    await expect(
      call(playbookDelete)(new Request('http://localhost/api'), operatorSession(), {
        id: otherTenantId,
        playbookId: created.id,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('requires an operator session', async () => {
    await expect(
      call(playbooksGet)(new Request('http://localhost/api'), { ...operatorSession(), operatorId: null }, {
        id: tenantId,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
