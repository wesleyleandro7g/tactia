/**
 * Admin schedule routes against a real Postgres. `createApiHandler` is replaced
 * by a pass-through so an operator session can be injected; everything below
 * (tenant scoping, ScheduleService, audit) is production code.
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

import { prisma, TenantRepository } from '@tactia/database';
import { createId, type RequestContext } from '@tactia/shared';
import { UserRepository, MembershipRepository } from '@tactia/database';
import { GET as schedulesGet, POST as schedulesPost } from '@/app/api/v1/tenants/[id]/schedules/route';
import { PATCH as schedulePatch, DELETE as scheduleDelete } from '@/app/api/v1/tenants/[id]/schedules/[scheduleId]/route';
import { POST as scheduleEnabled } from '@/app/api/v1/tenants/[id]/schedules/[scheduleId]/enabled/route';
import { POST as scheduleTrigger } from '@/app/api/v1/tenants/[id]/schedules/[scheduleId]/trigger/route';
import { POST as scheduleReset } from '@/app/api/v1/tenants/[id]/schedules/[scheduleId]/reset/route';
import { GET as scheduleOccurrences } from '@/app/api/v1/tenants/[id]/schedules/[scheduleId]/occurrences/route';

type Handler = (request: Request, ctx: RequestContext, params: Record<string, string>) => Promise<unknown>;
const call = (handler: unknown) => handler as Handler;

const SLUGS = ['admin-sched-co', 'admin-sched-other'];
let tenantId: string;
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
    await prisma.scheduleOccurrence.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.schedule.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.actionExecution.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.action.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();
  const tenants = new TenantRepository(prisma);
  tenantId = (await tenants.create({ name: 'Admin Sched Co', slug: SLUGS[0]! })).id;

  // Owner user so the ai_agent runner can resolve a real principal.
  const users = new UserRepository(prisma);
  const memberships = new MembershipRepository(prisma);
  ownerAuthId = createId();
  await prisma.authUser.create({
    data: { id: ownerAuthId, name: 'Owner', email: `owner-${ownerAuthId}@sched.local`, emailVerified: true },
  });
  ownerUserId = (
    await users.create({ externalAuthId: ownerAuthId, name: 'Owner', email: `owner-${ownerAuthId}@sched.local` })
  ).id;
  await memberships.create({ tenantId, userId: ownerUserId, role: 'owner', status: 'active' });

  operatorAuthId = createId();
  await prisma.operatorAuthUser.create({
    data: { id: operatorAuthId, name: 'ops', email: `ops-${operatorAuthId}@sched.local`, emailVerified: true },
  });
  operatorId = (
    await prisma.operator.create({
      data: { id: createId(), externalAuthId: operatorAuthId, name: 'ops', email: `ops-${operatorAuthId}@sched.local` },
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

describe('admin schedule routes', () => {
  it('creates, lists, triggers, resets, disables and deletes a schedule', async () => {
    // Create an action schedule that proposes (no auto-execute, no LLM needed).
    const created = (await call(schedulesPost)(
      jsonRequest({
        name: 'Envio semanal',
        target: 'action',
        effectMode: 'propose',
        frequency: 'weekly',
        recurrenceConfig: { weekdays: [1], localTime: '09:00' },
        actionType: 'send_email',
        actionInput: { to: 'dono@empresa.com', subject: 'Oi', body: 'Corpo' },
      }),
      operatorSession(),
      { id: tenantId },
    )) as { id: string };
    expect(created.id).toBeTruthy();

    const list = (await call(schedulesGet)(new Request('http://localhost/api'), operatorSession(), {
      id: tenantId,
    })) as { items: Array<{ id: string; name: string }>; total: number };
    expect(list.total).toBe(1);
    expect(list.items[0]?.name).toBe('Envio semanal');

    // Trigger now → creates a manual occurrence and runs it inline (proposes,
    // lands in awaiting_approval). The occurrence completes.
    const occurrence = (await call(scheduleTrigger)(
      new Request('http://localhost/api', { method: 'POST' }),
      operatorSession(),
      { id: tenantId, scheduleId: created.id },
    )) as { id: string; periodKey: string };
    expect(occurrence.id).toBeTruthy();

    const occurrences = (await call(scheduleOccurrences)(
      new Request('http://localhost/api'),
      operatorSession(),
      { id: tenantId, scheduleId: created.id },
    )) as { items: Array<{ periodKey: string; status: string }>; total: number };
    expect(occurrences.total).toBe(1);
    const periodKey = occurrences.items[0]!.periodKey;

    // Reset the occurrence so it could run again.
    const reset = (await call(scheduleReset)(
      jsonRequest({ periodKey }),
      operatorSession(),
      { id: tenantId, scheduleId: created.id },
    )) as { reset: boolean };
    expect(reset.reset).toBe(true);
    const afterReset = (await call(scheduleOccurrences)(
      new Request('http://localhost/api'),
      operatorSession(),
      { id: tenantId, scheduleId: created.id },
    )) as { total: number };
    expect(afterReset.total).toBe(0);

    // Update the name.
    const patched = (await call(schedulePatch)(
      new Request('http://localhost/api', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renomeado' }),
      }),
      operatorSession(),
      { id: tenantId, scheduleId: created.id },
    )) as { name: string };
    expect(patched.name).toBe('Renomeado');

    // Disable.
    const disabled = (await call(scheduleEnabled)(
      jsonRequest({ enabled: false }),
      operatorSession(),
      { id: tenantId, scheduleId: created.id },
    )) as { enabled: boolean };
    expect(disabled.enabled).toBe(false);

    // Delete.
    const deleted = (await call(scheduleDelete)(
      new Request('http://localhost/api', { method: 'DELETE' }),
      operatorSession(),
      { id: tenantId, scheduleId: created.id },
    )) as { deleted: boolean };
    expect(deleted.deleted).toBe(true);

    const emptied = (await call(schedulesGet)(new Request('http://localhost/api'), operatorSession(), {
      id: tenantId,
    })) as { total: number };
    expect(emptied.total).toBe(0);
  });

  it('triggers an ai_agent schedule inline without AUTHENTICATION_ERROR (mock LLM)', async () => {
    const created = (await call(schedulesPost)(
      jsonRequest({
        name: 'Briefing IA',
        target: 'ai_agent',
        effectMode: 'propose',
        frequency: 'daily',
        recurrenceConfig: { localTime: '08:00' },
        aiConfig: { instruction: 'Diga olá em uma frase.' },
      }),
      operatorSession(),
      { id: tenantId },
    )) as { id: string };

    // Manual trigger runs the occurrence inline through the agent runner, which
    // must resolve the tenant owner as principal (regression: it used a system
    // context with no user/operator and failed with AUTHENTICATION_ERROR).
    const occurrence = (await call(scheduleTrigger)(
      new Request('http://localhost/api', { method: 'POST' }),
      operatorSession(),
      { id: tenantId, scheduleId: created.id },
    )) as { id: string };
    expect(occurrence.id).toBeTruthy();

    const occurrences = (await call(scheduleOccurrences)(
      new Request('http://localhost/api'),
      operatorSession(),
      { id: tenantId, scheduleId: created.id },
    )) as { items: Array<{ status: string; error: string | null }> };
    const latest = occurrences.items[0]!;
    expect(latest.error).toBeNull();
    expect(latest.status).toBe('completed');

    await call(scheduleDelete)(
      new Request('http://localhost/api', { method: 'DELETE' }),
      operatorSession(),
      { id: tenantId, scheduleId: created.id },
    );
  });
});
