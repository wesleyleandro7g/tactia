/**
 * Operator metrics for command-center events against a real Postgres.
 * `createApiHandler` is replaced so a session can be injected; tenant
 * scoping and aggregation are production code.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  createApiHandler: (
    _options: { auth: string },
    handler: (request: Request, ctx: unknown, params: Record<string, string>) => unknown,
  ) => handler,
  searchParamsRecord: (request: Request) =>
    Object.fromEntries(new URL(request.url).searchParams.entries()),
}));

import { prisma, TenantRepository } from '@tactia/database';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { GET as metricsGet } from '@/app/api/v1/tenants/[id]/command-center/metrics/route';

type Handler = (request: Request, ctx: RequestContext, params: Record<string, string>) => Promise<unknown>;
const call = (handler: unknown) => handler as Handler;

const SLUGS = ['admin-metrics-co', 'admin-metrics-other'];
let tenantId: string;
let otherTenantId: string;
let operatorId: string;
let operatorAuthId: string;

function operatorSession(): RequestContext {
  return { requestId: createId(), tenantId: null, userId: null, role: null, operatorId, ip: null };
}

function metricsRequest(query = 'from=2026-09-01&to=2026-09-07') {
  return new Request(`http://localhost/api?${query}`);
}

async function insertEvent(input: {
  tenantId: string;
  eventKey: string;
  name: string;
  metadata?: Record<string, string | number | boolean | null>;
  occurredAt: Date;
}) {
  await prisma.commandCenterEvent.create({
    data: {
      id: createId(),
      tenantId: input.tenantId,
      eventKey: input.eventKey,
      name: input.name,
      entityId: createId(),
      metadata: input.metadata ?? {},
      occurredAt: input.occurredAt,
    },
  });
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();
  const tenants = new TenantRepository(prisma);
  tenantId = (await tenants.create({ name: 'Admin Metrics Co', slug: SLUGS[0]! })).id;
  otherTenantId = (await tenants.create({ name: 'Other Metrics Co', slug: SLUGS[1]! })).id;

  operatorAuthId = createId();
  await prisma.operatorAuthUser.create({
    data: { id: operatorAuthId, name: 'ops-metrics', email: `ops-${operatorAuthId}@metrics.local`, emailVerified: true },
  });
  operatorId = (
    await prisma.operator.create({
      data: {
        id: createId(),
        externalAuthId: operatorAuthId,
        name: 'ops-metrics',
        email: `ops-${operatorAuthId}@metrics.local`,
      },
    })
  ).id;

  await insertEvent({
    tenantId,
    eventKey: 'metrics-plan',
    name: 'plan_created',
    metadata: { version: 1 },
    occurredAt: new Date('2026-09-02T12:00:00.000Z'),
  });
  await insertEvent({
    tenantId,
    eventKey: 'metrics-asked',
    name: 'clarification_requested',
    metadata: { gapId: createId() },
    occurredAt: new Date('2026-09-03T12:00:00.000Z'),
  });
  await insertEvent({
    tenantId,
    eventKey: 'metrics-reply',
    name: 'clarification_received',
    metadata: { gapId: createId(), clear: true, question: 'Quanto vendeu?', phone: '+5511999999999' },
    occurredAt: new Date('2026-09-04T12:00:00.000Z'),
  });
  await insertEvent({
    tenantId: otherTenantId,
    eventKey: 'metrics-other',
    name: 'decision_resolved',
    metadata: { kind: 'approval', choice: 'approved' },
    occurredAt: new Date('2026-09-02T12:00:00.000Z'),
  });
});

afterAll(async () => {
  await cleanUp();
  await prisma.auditLog.deleteMany({ where: { operatorId } });
  await prisma.operator.deleteMany({ where: { id: operatorId } });
  await prisma.operatorAuthUser.deleteMany({ where: { id: operatorAuthId } });
  await prisma.$disconnect();
});

describe('command center metrics routes', () => {
  it('aggregates one company and keeps another company out of the payload', async () => {
    const result = await call(metricsGet)(metricsRequest(), operatorSession(), { id: tenantId }) as {
      tenantId: string;
      metrics: Array<{ key: string; value: number | null; availability: string; denominator: { value: number } | null }>;
      events: { total: number; items: Array<{ name: string; metadata: Record<string, unknown> }> };
      unsupported: Array<{ key: string }>;
    };

    expect(result.tenantId).toBe(tenantId);
    expect(result.metrics.find((metric) => metric.key === 'plans_created')).toMatchObject({
      value: 1,
      availability: 'ready',
    });
    expect(result.metrics.find((metric) => metric.key === 'decisions_resolved')).toMatchObject({
      value: null,
      availability: 'empty',
    });
    expect(result.metrics.find((metric) => metric.key === 'clarification_response_rate')).toMatchObject({
      value: 1,
      denominator: { value: 1 },
    });
    expect(result.events.total).toBe(3);
    expect(result.events.items.map((item) => item.name).sort()).toEqual([
      'clarification_received',
      'clarification_requested',
      'plan_created',
    ]);
    expect(JSON.stringify(result)).not.toMatch(/Quanto vendeu|\+5511|question|phone|answer/i);
    expect(result.unsupported.map((item) => item.key)).toEqual([
      'time_to_first_value',
      'effort_reduction',
      'commercial_outcome',
    ]);

    const other = await call(metricsGet)(metricsRequest(), operatorSession(), { id: otherTenantId }) as {
      tenantId: string;
      metrics: Array<{ key: string; value: number | null }>;
      events: { total: number };
    };
    expect(other.tenantId).toBe(otherTenantId);
    expect(other.metrics.find((metric) => metric.key === 'decisions_resolved')?.value).toBe(1);
    expect(other.metrics.find((metric) => metric.key === 'plans_created')?.value).toBeNull();
    expect(other.events.total).toBe(1);
  });

  it('rejects a missing operator, unknown tenant and inverted window', async () => {
    await expect(
      call(metricsGet)(metricsRequest(), { ...operatorSession(), operatorId: null }, { id: tenantId }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHENTICATION_ERROR });
    await expect(
      call(metricsGet)(metricsRequest(), operatorSession(), { id: createId() }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    await expect(
      call(metricsGet)(metricsRequest('from=2026-09-10&to=2026-09-01'), operatorSession(), { id: tenantId }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('paginates the event detail and filters by event name', async () => {
    const page = await call(metricsGet)(
      metricsRequest('from=2026-09-01&to=2026-09-07&page=2&pageSize=1'),
      operatorSession(),
      { id: tenantId },
    ) as { events: { total: number; page: number; pageSize: number; items: unknown[] } };
    expect(page.events.total).toBe(3);
    expect(page.events.page).toBe(2);
    expect(page.events.pageSize).toBe(1);
    expect(page.events.items).toHaveLength(1);

    const filtered = await call(metricsGet)(
      metricsRequest('from=2026-09-01&to=2026-09-07&name=plan_created'),
      operatorSession(),
      { id: tenantId },
    ) as {
      metrics: Array<{ key: string; value: number | null }>;
      events: { total: number; items: Array<{ name: string }> };
    };
    expect(filtered.metrics.find((metric) => metric.key === 'plans_created')?.value).toBe(1);
    expect(filtered.events.total).toBe(1);
    expect(filtered.events.items[0]?.name).toBe('plan_created');
  });
});
