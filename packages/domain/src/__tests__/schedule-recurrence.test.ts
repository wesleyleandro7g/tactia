import { describe, expect, it } from 'vitest';
import {
  computePeriodKey,
  daysInMonth,
  isDue,
  isoWeek,
  nthBusinessDayOfMonth,
  type ScheduleRecurrence,
} from '../services/schedule-recurrence';

const TZ = 'America/Sao_Paulo'; // UTC-3 (no DST since 2019)

/** Build a UTC instant that maps to the given São Paulo local wall clock. */
function spInstant(y: number, mo: number, d: number, h: number, mi = 0): Date {
  // UTC-3 → add 3h to get UTC.
  return new Date(Date.UTC(y, mo - 1, d, h + 3, mi));
}

function rec(partial: Partial<ScheduleRecurrence>): ScheduleRecurrence {
  return {
    frequency: 'daily',
    recurrenceConfig: {},
    cronExpression: null,
    timezone: TZ,
    ...partial,
  };
}

describe('schedule recurrence — helpers', () => {
  it('daysInMonth handles leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('nthBusinessDayOfMonth finds the 5th business day', () => {
    // Jan 2026: 1st is Thursday. Business days: 1(Thu),2(Fri),5(Mon),6(Tue),7(Wed)...
    expect(nthBusinessDayOfMonth(2026, 1, 5)).toBe(7);
    // 1st business day.
    expect(nthBusinessDayOfMonth(2026, 1, 1)).toBe(1);
  });

  it('isoWeek is stable within a week', () => {
    const a = isoWeek(2026, 1, 12); // Monday
    const b = isoWeek(2026, 1, 15); // Thursday same week
    expect(a).toEqual(b);
  });
});

describe('schedule recurrence — isDue', () => {
  it('daily fires only at/after localTime', () => {
    const r = rec({ frequency: 'daily', recurrenceConfig: { localTime: '08:00' } });
    expect(isDue(r, spInstant(2026, 1, 15, 7, 59))).toBe(false);
    expect(isDue(r, spInstant(2026, 1, 15, 8, 0))).toBe(true);
    expect(isDue(r, spInstant(2026, 1, 15, 23, 30))).toBe(true);
  });

  it('weekly fires only on configured weekdays', () => {
    // 2026-01-19 is a Monday, 2026-01-20 a Tuesday.
    const r = rec({ frequency: 'weekly', recurrenceConfig: { weekdays: [1], localTime: '09:00' } });
    expect(isDue(r, spInstant(2026, 1, 19, 9, 0))).toBe(true);
    expect(isDue(r, spInstant(2026, 1, 20, 9, 0))).toBe(false);
    expect(isDue(r, spInstant(2026, 1, 19, 8, 0))).toBe(false);
  });

  it('monthly by dayOfMonth fires on that day', () => {
    const r = rec({ frequency: 'monthly', recurrenceConfig: { dayOfMonth: 15, localTime: '10:00' } });
    expect(isDue(r, spInstant(2026, 3, 15, 10, 0))).toBe(true);
    expect(isDue(r, spInstant(2026, 3, 14, 10, 0))).toBe(false);
  });

  it('monthly by dayOfMonth clamps to month length', () => {
    // Feb 2026 has 28 days; dayOfMonth 31 should fire on the 28th.
    const r = rec({ frequency: 'monthly', recurrenceConfig: { dayOfMonth: 31, localTime: '00:00' } });
    expect(isDue(r, spInstant(2026, 2, 28, 0, 0))).toBe(true);
    expect(isDue(r, spInstant(2026, 2, 27, 0, 0))).toBe(false);
  });

  it('monthly by nthBusinessDay fires on the computed day', () => {
    const r = rec({ frequency: 'monthly', recurrenceConfig: { nthBusinessDay: 5, localTime: '00:00' } });
    expect(isDue(r, spInstant(2026, 1, 7, 0, 0))).toBe(true);
    expect(isDue(r, spInstant(2026, 1, 6, 0, 0))).toBe(false);
  });

  it('custom and manual never fire automatically', () => {
    expect(isDue(rec({ frequency: 'custom', cronExpression: '* * * * *' }), spInstant(2026, 1, 15, 12))).toBe(false);
    expect(isDue(rec({ frequency: 'manual' }), spInstant(2026, 1, 15, 12))).toBe(false);
  });
});

describe('schedule recurrence — computePeriodKey', () => {
  it('daily key is the local date', () => {
    expect(computePeriodKey(rec({ frequency: 'daily' }), spInstant(2026, 1, 15, 8))).toBe('2026-01-15');
  });

  it('weekly key is the ISO week and stable within the week', () => {
    const monday = computePeriodKey(rec({ frequency: 'weekly' }), spInstant(2026, 1, 12, 9));
    const thursday = computePeriodKey(rec({ frequency: 'weekly' }), spInstant(2026, 1, 15, 9));
    expect(monday).toBe(thursday);
    expect(monday).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('monthly key is the local year-month', () => {
    expect(computePeriodKey(rec({ frequency: 'monthly' }), spInstant(2026, 3, 15, 10))).toBe('2026-03');
  });

  it('respects timezone at the day boundary', () => {
    // 2026-01-16 01:00 UTC is still 2026-01-15 22:00 in São Paulo.
    const r = rec({ frequency: 'daily' });
    expect(computePeriodKey(r, new Date(Date.UTC(2026, 0, 16, 1, 0)))).toBe('2026-01-15');
  });
});
