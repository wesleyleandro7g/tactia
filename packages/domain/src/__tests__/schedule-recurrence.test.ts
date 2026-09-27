import { describe, expect, it } from 'vitest';
import {
  computePeriodKey,
  daysInMonth,
  isDue,
  isoWeek,
  isValidCronExpression,
  matchesCron,
  matchesCronField,
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

  it('manual never fires automatically', () => {
    expect(isDue(rec({ frequency: 'manual' }), spInstant(2026, 1, 15, 12))).toBe(false);
  });

  it('custom without cronExpression never fires', () => {
    expect(isDue(rec({ frequency: 'custom', cronExpression: null }), spInstant(2026, 1, 15, 12))).toBe(false);
  });

  it('custom fires on cron minute matches in the schedule timezone', () => {
    // "*/5 * * * *" — every 5 minutes.
    const r = rec({ frequency: 'custom', cronExpression: '*/5 * * * *' });
    expect(isDue(r, spInstant(2026, 1, 15, 12, 0))).toBe(true);
    expect(isDue(r, spInstant(2026, 1, 15, 12, 5))).toBe(true);
    expect(isDue(r, spInstant(2026, 1, 15, 12, 3))).toBe(false);
  });

  it('custom honors specific minute/hour', () => {
    // 30 8 * * * — 08:30 every day.
    const r = rec({ frequency: 'custom', cronExpression: '30 8 * * *' });
    expect(isDue(r, spInstant(2026, 1, 15, 8, 30))).toBe(true);
    expect(isDue(r, spInstant(2026, 1, 15, 8, 0))).toBe(false);
    expect(isDue(r, spInstant(2026, 1, 15, 9, 30))).toBe(false);
  });

  it('custom honors day-of-week', () => {
    // 0 9 * * 1 — 09:00 on Mondays. 2026-01-19 is a Monday, 2026-01-20 Tuesday.
    const r = rec({ frequency: 'custom', cronExpression: '0 9 * * 1' });
    expect(isDue(r, spInstant(2026, 1, 19, 9, 0))).toBe(true);
    expect(isDue(r, spInstant(2026, 1, 20, 9, 0))).toBe(false);
  });

  it('custom rejects malformed expressions (never fires)', () => {
    expect(isDue(rec({ frequency: 'custom', cronExpression: 'not-a-cron' }), spInstant(2026, 1, 15, 12))).toBe(false);
    expect(isDue(rec({ frequency: 'custom', cronExpression: '* * * *' }), spInstant(2026, 1, 15, 12))).toBe(false);
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

describe('schedule recurrence — cron matching', () => {
  it('matchesCronField handles wildcard, list, range and step', () => {
    expect(matchesCronField('*', 42, 0, 59)).toBe(true);
    expect(matchesCronField('5', 5, 0, 59)).toBe(true);
    expect(matchesCronField('5', 6, 0, 59)).toBe(false);
    expect(matchesCronField('1,2,3', 2, 0, 59)).toBe(true);
    expect(matchesCronField('1,2,3', 4, 0, 59)).toBe(false);
    expect(matchesCronField('10-20', 15, 0, 59)).toBe(true);
    expect(matchesCronField('10-20', 25, 0, 59)).toBe(false);
    expect(matchesCronField('*/15', 30, 0, 59)).toBe(true);
    expect(matchesCronField('*/15', 20, 0, 59)).toBe(false);
    expect(matchesCronField('0-30/10', 20, 0, 59)).toBe(true);
    expect(matchesCronField('0-30/10', 25, 0, 59)).toBe(false);
  });

  it('matchesCronField rejects malformed tokens and out-of-range values', () => {
    expect(matchesCronField('', 0, 0, 59)).toBe(false);
    expect(matchesCronField('abc', 0, 0, 59)).toBe(false);
    expect(matchesCronField('*/0', 0, 0, 59)).toBe(false);
    expect(matchesCronField('70', 70, 0, 59)).toBe(false); // above max
    expect(matchesCronField('20-10', 15, 0, 59)).toBe(false); // inverted range
    expect(matchesCronField('1/2/3', 1, 0, 59)).toBe(false); // double step
  });

  it('matchesCron requires exactly 5 fields', () => {
    const parts = { year: 2026, month: 1, day: 15, hour: 12, minute: 0, weekday: 4 };
    expect(matchesCron('0 12 * * *', parts)).toBe(true);
    expect(matchesCron('0 12 * *', parts)).toBe(false);
    expect(matchesCron('0 12 * * * *', parts)).toBe(false);
  });

  it('matchesCron unions dom and dow when both are restricted (POSIX)', () => {
    // "0 0 13 * 5" — midnight on the 13th OR any Friday.
    // 2026-02-13 is a Friday (both match); pick a case where only dow matches.
    // 2026-01-16 is a Friday and not the 13th.
    const friday16 = { year: 2026, month: 1, day: 16, hour: 0, minute: 0, weekday: 5 };
    const the13thWed = { year: 2026, month: 5, day: 13, hour: 0, minute: 0, weekday: 3 };
    const neither = { year: 2026, month: 1, day: 14, hour: 0, minute: 0, weekday: 3 };
    expect(matchesCron('0 0 13 * 5', friday16)).toBe(true); // dow only
    expect(matchesCron('0 0 13 * 5', the13thWed)).toBe(true); // dom only
    expect(matchesCron('0 0 13 * 5', neither)).toBe(false);
  });

  it('matchesCron accepts 7 as Sunday', () => {
    const sunday = { year: 2026, month: 1, day: 18, hour: 0, minute: 0, weekday: 0 };
    expect(matchesCron('0 0 * * 7', sunday)).toBe(true);
    expect(matchesCron('0 0 * * 0', sunday)).toBe(true);
  });

  it('isValidCronExpression accepts well-formed expressions', () => {
    expect(isValidCronExpression('*/5 * * * *')).toBe(true);
    expect(isValidCronExpression('30 8 * * *')).toBe(true);
    expect(isValidCronExpression('0 9 * * 1')).toBe(true);
    expect(isValidCronExpression('0 0 13 * 5')).toBe(true);
    expect(isValidCronExpression('0 0 * * 7')).toBe(true); // 7 = Sunday
    expect(isValidCronExpression('0,15,30,45 0-23 1-31 1-12 *')).toBe(true);
    expect(isValidCronExpression('  0   12   *   *   *  ')).toBe(true); // extra spaces
  });

  it('isValidCronExpression rejects malformed expressions', () => {
    expect(isValidCronExpression('not-a-cron')).toBe(false);
    expect(isValidCronExpression('* * * *')).toBe(false); // 4 fields
    expect(isValidCronExpression('* * * * * *')).toBe(false); // 6 fields
    expect(isValidCronExpression('60 * * * *')).toBe(false); // minute out of range
    expect(isValidCronExpression('* 24 * * *')).toBe(false); // hour out of range
    expect(isValidCronExpression('* * 32 * *')).toBe(false); // dom out of range
    expect(isValidCronExpression('* * * 13 *')).toBe(false); // month out of range
    expect(isValidCronExpression('* * * * 8')).toBe(false); // dow out of range
    expect(isValidCronExpression('*/0 * * * *')).toBe(false); // zero step
    expect(isValidCronExpression('20-10 * * * *')).toBe(false); // inverted range
    expect(isValidCronExpression('')).toBe(false);
  });
});
