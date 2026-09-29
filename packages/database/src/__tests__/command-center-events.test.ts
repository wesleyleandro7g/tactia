import { afterAll, describe, expect, it } from 'vitest';
import { createId } from '@tactia/shared';
import { prisma } from '../client';
import {
  aggregateCommandCenterEvents,
  listCommandCenterEvents,
  recordCommandCenterEvent,
  sanitizeCommandCenterEventMetadata,
} from '../repositories/command-center-events';
import { TenantRepository } from '../repositories/tenant-repository';

const tenants = new TenantRepository(prisma);
const tenantIds: string[] = [];

afterAll(async () => {
  if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

async function makeTenant(label: string) {
  const id = createId();
  const tenant = await tenants.create({
    name: `Events ${label}`,
    slug: `cc-events-${label}-${id.slice(0, 8)}`,
  });
  tenantIds.push(tenant.id);
  return tenant;
}

async function insert(input: {
  tenantId: string;
  eventKey: string;
  name: 'plan_created' | 'decision_resolved' | 'execution_state_changed' | 'clarification_requested' | 'clarification_received';
  entityId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  occurredAt: Date;
}) {
  await prisma.commandCenterEvent.create({
    data: {
      id: createId(),
      tenantId: input.tenantId,
      eventKey: input.eventKey,
      name: input.name,
      entityId: input.entityId ?? createId(),
      metadata: input.metadata ?? {},
      occurredAt: input.occurredAt,
    },
  });
}

const window = {
  from: new Date('2026-09-01T00:00:00.000Z'),
  to: new Date('2026-09-08T00:00:00.000Z'),
};

describe('command center event aggregation', () => {
  it('keeps a duplicate eventKey from counting twice', async () => {
    const tenant = await makeTenant('dedupe');
    const entityId = createId();
    await recordCommandCenterEvent(prisma, {
      tenantId: tenant.id,
      eventKey: `plan-created:${entityId}`,
      name: 'plan_created',
      entityId,
      metadata: { version: 1 },
    });
    await recordCommandCenterEvent(prisma, {
      tenantId: tenant.id,
      eventKey: `plan-created:${entityId}`,
      name: 'plan_created',
      entityId,
      metadata: { version: 1 },
    });

    expect(await prisma.commandCenterEvent.count({ where: { tenantId: tenant.id } })).toBe(1);
    const aggregate = await aggregateCommandCenterEvents(prisma, { tenantId: tenant.id, ...window, from: new Date('2020-01-01T00:00:00.000Z'), to: new Date('2030-01-01T00:00:00.000Z') });
    expect(aggregate.counts.plan_created).toBe(1);
  });

  it('aggregates one company and window without the other company or days outside it', async () => {
    const tenant = await makeTenant('a');
    const other = await makeTenant('b');
    await insert({
      tenantId: tenant.id,
      eventKey: 'in-window-plan',
      name: 'plan_created',
      occurredAt: new Date('2026-09-02T12:00:00.000Z'),
    });
    await insert({
      tenantId: tenant.id,
      eventKey: 'in-window-decision',
      name: 'decision_resolved',
      metadata: { kind: 'approval', choice: 'approved' },
      occurredAt: new Date('2026-09-03T12:00:00.000Z'),
    });
    await insert({
      tenantId: tenant.id,
      eventKey: 'outside-window',
      name: 'plan_created',
      occurredAt: new Date('2026-08-31T23:59:59.000Z'),
    });
    await insert({
      tenantId: other.id,
      eventKey: 'other-company',
      name: 'plan_created',
      occurredAt: new Date('2026-09-02T12:00:00.000Z'),
    });
    await insert({
      tenantId: tenant.id,
      eventKey: 'clear-reply',
      name: 'clarification_received',
      metadata: { gapId: createId(), clear: true },
      occurredAt: new Date('2026-09-04T08:00:00.000Z'),
    });
    await insert({
      tenantId: tenant.id,
      eventKey: 'unclear-reply',
      name: 'clarification_received',
      metadata: { gapId: createId(), clear: false },
      occurredAt: new Date('2026-09-05T08:00:00.000Z'),
    });

    const aggregate = await aggregateCommandCenterEvents(prisma, { tenantId: tenant.id, ...window });
    expect(aggregate.counts.plan_created).toBe(1);
    expect(aggregate.counts.decision_resolved).toBe(1);
    expect(aggregate.counts.clarification_received).toBe(2);
    expect(aggregate.counts.execution_state_changed).toBe(0);
    expect(aggregate.decisions.kind).toEqual({ approval: 1 });
    expect(aggregate.clarifications).toEqual({ clear: 1, unclear: 1 });
    expect(aggregate.daily).toEqual([
      { day: '2026-09-02', name: 'plan_created', count: 1 },
      { day: '2026-09-03', name: 'decision_resolved', count: 1 },
      { day: '2026-09-04', name: 'clarification_received', count: 1 },
      { day: '2026-09-05', name: 'clarification_received', count: 1 },
    ]);

    const otherAggregate = await aggregateCommandCenterEvents(prisma, { tenantId: other.id, ...window });
    expect(otherAggregate.counts.plan_created).toBe(1);
    expect(otherAggregate.counts.decision_resolved).toBe(0);
    expect(otherAggregate.counts.clarification_received).toBe(0);
  });

  it('paginates the event list and strips unknown metadata keys', async () => {
    const tenant = await makeTenant('page');
    for (let index = 0; index < 3; index += 1) {
      await insert({
        tenantId: tenant.id,
        eventKey: `page-${index}`,
        name: 'execution_state_changed',
        metadata: { status: 'completed', planId: createId(), phone: '+5511999999999' },
        occurredAt: new Date(`2026-09-0${index + 1}T10:00:00.000Z`),
      });
    }

    const page = await listCommandCenterEvents(prisma, {
      tenantId: tenant.id,
      ...window,
      page: 2,
      pageSize: 1,
    });
    expect(page.total).toBe(3);
    expect(page.page).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.metadata).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(page.items[0]?.metadata).not.toHaveProperty('phone');
  });

  it('returns empty counts when the company has no events', async () => {
    const tenant = await makeTenant('empty');
    const aggregate = await aggregateCommandCenterEvents(prisma, { tenantId: tenant.id, ...window });
    expect(aggregate.counts).toEqual({
      plan_created: 0,
      decision_resolved: 0,
      execution_state_changed: 0,
      clarification_requested: 0,
      clarification_received: 0,
    });
    expect(aggregate.daily).toEqual([]);
    const listed = await listCommandCenterEvents(prisma, { tenantId: tenant.id, ...window, page: 1, pageSize: 20 });
    expect(listed.total).toBe(0);
    expect(listed.items).toEqual([]);
  });

  it('never keeps question, answer, phone or name fields in metadata', () => {
    expect(
      sanitizeCommandCenterEventMetadata({
        gapId: 'gap-1',
        clear: false,
        question: 'Quanto vendeu?',
        answer: 'Não sei',
        phone: '+5511999999999',
        name: 'Maria',
      }),
    ).toEqual({ gapId: 'gap-1', clear: false });
  });
});
