import { afterAll, describe, expect, it } from 'vitest';
import { createId } from '@tactia/shared';
import { prisma } from '../client';
import { ScheduleRepository } from '../repositories/schedule-repository';
import { ScheduleOccurrenceRepository } from '../repositories/schedule-occurrence-repository';
import { TenantRepository } from '../repositories/tenant-repository';

const tenants = new TenantRepository(prisma);
const schedules = new ScheduleRepository(prisma);
const occurrences = new ScheduleOccurrenceRepository(prisma);
const tenantIds: string[] = [];

afterAll(async () => {
  if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

async function makeTenant() {
  const id = createId();
  const tenant = await tenants.create({
    name: 'Schedule Test',
    slug: `schedule-${id}`,
    timezone: 'America/Sao_Paulo',
    currency: 'BRL',
  });
  tenantIds.push(tenant.id);
  return tenant;
}

describe('schedule persistence', () => {
  it('creates and updates a schedule scoped to the tenant', async () => {
    const tenant = await makeTenant();
    const schedule = await schedules.create({
      tenantId: tenant.id,
      name: 'Briefing diário',
      target: 'ai_agent',
      frequency: 'daily',
      recurrenceConfig: { localTime: '08:00' },
      aiConfig: { instruction: 'Gere o briefing do dia' },
    });
    expect(schedule.effectMode).toBe('propose');
    expect(schedule.enabled).toBe(true);

    const updated = await schedules.update(
      { tenantId: tenant.id, id: schedule.id },
      { enabled: false, effectMode: 'auto_execute' },
    );
    expect(updated.enabled).toBe(false);
    expect(updated.effectMode).toBe('auto_execute');

    // Cross-tenant isolation: another tenant cannot see it.
    const other = await makeTenant();
    const notFound = await schedules.findById({ tenantId: other.id, id: schedule.id });
    expect(notFound).toBeNull();
  });

  it('createExclusive is idempotent per (schedule, periodKey)', async () => {
    const tenant = await makeTenant();
    const schedule = await schedules.create({
      tenantId: tenant.id,
      name: 'Envio semanal',
      target: 'action',
      frequency: 'weekly',
      actionType: 'send_email',
      actionInput: { to: 'x@y.z', subject: 's', body: 'b' },
      recurrenceConfig: { weekdays: [1], localTime: '09:00' },
    });

    const [a, b] = await Promise.all([
      occurrences.createExclusive({ tenantId: tenant.id, scheduleId: schedule.id, periodKey: '2026-W03' }),
      occurrences.createExclusive({ tenantId: tenant.id, scheduleId: schedule.id, periodKey: '2026-W03' }),
    ]);
    expect(a.occurrence.id).toBe(b.occurrence.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
  });

  it('reset (deleteByPeriod) allows a period to run again', async () => {
    const tenant = await makeTenant();
    const schedule = await schedules.create({
      tenantId: tenant.id,
      name: 'Mensal',
      target: 'action',
      frequency: 'monthly',
      actionType: 'create_task',
      recurrenceConfig: { dayOfMonth: 15, localTime: '10:00' },
    });
    const first = await occurrences.createExclusive({
      tenantId: tenant.id,
      scheduleId: schedule.id,
      periodKey: '2026-01',
    });
    expect(first.created).toBe(true);

    await occurrences.deleteByPeriod({ tenantId: tenant.id, scheduleId: schedule.id, periodKey: '2026-01' });

    const again = await occurrences.createExclusive({
      tenantId: tenant.id,
      scheduleId: schedule.id,
      periodKey: '2026-01',
    });
    expect(again.created).toBe(true);
    expect(again.occurrence.id).not.toBe(first.occurrence.id);
  });
});
