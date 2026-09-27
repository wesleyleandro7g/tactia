import { describe, expect, it, vi } from 'vitest';
import { ScheduleService, type ScheduleServiceDeps } from '../services/schedule-service';

type ScheduleRow = {
  id: string;
  tenantId: string;
  timezone: string | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'custom' | 'manual';
  recurrenceConfig: Record<string, unknown>;
  cronExpression: string | null;
  repeatMode: 'infinite' | 'count';
  maxOccurrences: number | null;
  successCount: number;
};

type OccurrenceRow = { id: string; tenantId: string; scheduleId: string; periodKey: string };

/** Minimal in-memory doubles that mimic the repository contract used by the tick. */
function makeDeps(schedules: ScheduleRow[]) {
  const occurrences: OccurrenceRow[] = [];
  let seq = 0;

  const deps: ScheduleServiceDeps = {
    schedules: {
      listActiveForSchedule: async () => schedules,
    } as unknown as ScheduleServiceDeps['schedules'],
    occurrences: {
      createExclusive: async (input: {
        tenantId: string;
        scheduleId: string;
        periodKey: string;
      }) => {
        const existing = occurrences.find(
          (o) => o.scheduleId === input.scheduleId && o.periodKey === input.periodKey,
        );
        if (existing) return { occurrence: existing, created: false };
        const occurrence: OccurrenceRow = {
          id: `occ-${(seq += 1)}`,
          tenantId: input.tenantId,
          scheduleId: input.scheduleId,
          periodKey: input.periodKey,
        };
        occurrences.push(occurrence);
        return { occurrence, created: true };
      },
    } as unknown as ScheduleServiceDeps['occurrences'],
    auditLogs: { record: async () => undefined } as unknown as ScheduleServiceDeps['auditLogs'],
    tenantTimezone: async () => 'America/Sao_Paulo',
    enqueueRun: vi.fn(async () => undefined),
  };
  return { deps, occurrences };
}

// 2026-01-15 08:00 in São Paulo (UTC-3) → 11:00 UTC.
const dueNow = new Date(Date.UTC(2026, 0, 15, 11, 0));

const dailySchedule: ScheduleRow = {
  id: 's1',
  tenantId: 't1',
  timezone: null,
  frequency: 'daily',
  recurrenceConfig: { localTime: '08:00' },
  cronExpression: null,
  repeatMode: 'infinite',
  maxOccurrences: null,
  successCount: 0,
};

describe('ScheduleService.enqueueDueSchedules', () => {
  it('enqueues a due schedule exactly once per period', async () => {
    const { deps, occurrences } = makeDeps([dailySchedule]);
    const service = new ScheduleService(deps);

    const first = await service.enqueueDueSchedules(dueNow);
    expect(first.enqueued).toBe(1);
    expect(occurrences).toHaveLength(1);

    // A second tick in the same period must not re-enqueue.
    const second = await service.enqueueDueSchedules(dueNow);
    expect(second.enqueued).toBe(0);
    expect(occurrences).toHaveLength(1);
    expect(deps.enqueueRun).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue before the local time', async () => {
    const { deps } = makeDeps([dailySchedule]);
    const service = new ScheduleService(deps);
    const tooEarly = new Date(Date.UTC(2026, 0, 15, 10, 0)); // 07:00 SP
    const result = await service.enqueueDueSchedules(tooEarly);
    expect(result.enqueued).toBe(0);
  });

  it('skips count-capped schedules that reached their budget', async () => {
    const exhausted: ScheduleRow = {
      ...dailySchedule,
      id: 's2',
      repeatMode: 'count',
      maxOccurrences: 2,
      successCount: 2,
    };
    const { deps } = makeDeps([exhausted]);
    const service = new ScheduleService(deps);
    const result = await service.enqueueDueSchedules(dueNow);
    expect(result.enqueued).toBe(0);
  });

  it('is a no-op without an enqueue sink', async () => {
    const { deps } = makeDeps([dailySchedule]);
    const service = new ScheduleService({ ...deps, enqueueRun: undefined });
    const result = await service.enqueueDueSchedules(dueNow);
    expect(result).toEqual({ enqueued: 0, evaluated: 0 });
  });
});
