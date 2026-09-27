import { z } from 'zod';

/**
 * Recurrence rules for schedules (spec §4). Hybrid model:
 * - structured `frequency` + `recurrenceConfig` for the common cases;
 * - optional `cronExpression` for the custom trigger (`frequency = custom`);
 * - `manual` never fires automatically.
 *
 * All time math is timezone-aware using the schedule's timezone (falls back to
 * the tenant timezone at the service layer). The tick runs every 5 minutes, so
 * "due" means: the local wall clock is at or after the configured `localTime`
 * within the target day/period, and no occurrence exists yet for that period
 * (idempotency is enforced by the occurrence's `periodKey`, computed here).
 */

export const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const recurrenceConfigSchema = z
  .object({
    /** Weekly: ISO-like weekday numbers 0=Sun..6=Sat. */
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
    /** Monthly by calendar day (1..31). Clamped to the month length. */
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    /** Monthly by N-th business day (1..23). Mutually exclusive with dayOfMonth. */
    nthBusinessDay: z.number().int().min(1).max(23).optional(),
    /** Local wall-clock time "HH:mm" at/after which the period is due. Default 00:00. */
    localTime: z.string().regex(HHMM).optional(),
  })
  .strict();

export type RecurrenceConfig = z.infer<typeof recurrenceConfigSchema>;

export const scheduleFrequencyValues = ['daily', 'weekly', 'monthly', 'custom', 'manual'] as const;
export type ScheduleFrequencyValue = (typeof scheduleFrequencyValues)[number];

export type ScheduleRecurrence = {
  frequency: ScheduleFrequencyValue;
  recurrenceConfig: RecurrenceConfig;
  cronExpression?: string | null;
  timezone: string;
};

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

type LocalParts = {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number; // 0..59
  weekday: number; // 0=Sun..6=Sat
};

const WEEKDAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of `now` in the given IANA timezone. */
export function localParts(now: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: WEEKDAY_MAP[get('weekday')] ?? 0,
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Minutes since local midnight. */
function minutesOfDay(parts: LocalParts): number {
  return parts.hour * 60 + parts.minute;
}

function localTimeMinutes(config: RecurrenceConfig): number {
  if (!config.localTime) return 0;
  const [h, m] = config.localTime.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** ISO week number (1..53) for a Y-M-D, plus the ISO week-year. */
export function isoWeek(year: number, month: number, day: number): { weekYear: number; week: number } {
  // Work in UTC to avoid DST edge cases; the input is a calendar date.
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { weekYear: date.getUTCFullYear(), week };
}

/** Number of days in a given month (1..12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The calendar day (1..31) that is the N-th business day (Mon–Fri) of the month. */
export function nthBusinessDayOfMonth(year: number, month: number, nth: number): number | null {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let day = 1; day <= total; day += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      count += 1;
      if (count === nth) return day;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Due evaluation and period key
// ---------------------------------------------------------------------------

/**
 * A stable key for the period `now` falls into, per frequency. Two ticks in the
 * same period return the same key, so the occurrence stays idempotent.
 * - daily: `YYYY-MM-DD`
 * - weekly: `YYYY-Www` (ISO week)
 * - monthly: `YYYY-MM`
 * - custom (cron): `YYYY-MM-DDTHH:mm` (minute granularity — the cron controls cadence)
 * - manual: caller supplies its own key; this returns a date key as a fallback.
 */
export function computePeriodKey(recurrence: ScheduleRecurrence, now: Date): string {
  const p = localParts(now, recurrence.timezone);
  switch (recurrence.frequency) {
    case 'daily':
      return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    case 'weekly': {
      const { weekYear, week } = isoWeek(p.year, p.month, p.day);
      return `${weekYear}-W${pad(week)}`;
    }
    case 'monthly':
      return `${p.year}-${pad(p.month)}`;
    case 'custom':
      return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
    case 'manual':
    default:
      return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  }
}

/**
 * Whether the schedule should fire for the period containing `now`. Idempotency
 * (not firing twice in the same period) is handled by the occurrence store; this
 * only answers "is this the right day/time?".
 *
 * `custom` (cron) and `manual` return false here: cron cadence is delegated to
 * the job scheduler and manual only fires on demand.
 */
export function isDue(recurrence: ScheduleRecurrence, now: Date): boolean {
  const p = localParts(now, recurrence.timezone);
  const config = recurrence.recurrenceConfig;
  const timeReached = minutesOfDay(p) >= localTimeMinutes(config);

  switch (recurrence.frequency) {
    case 'daily':
      return timeReached;
    case 'weekly': {
      const weekdays = config.weekdays ?? [];
      return weekdays.includes(p.weekday) && timeReached;
    }
    case 'monthly': {
      if (config.nthBusinessDay !== undefined) {
        const target = nthBusinessDayOfMonth(p.year, p.month, config.nthBusinessDay);
        return target !== null && p.day === target && timeReached;
      }
      if (config.dayOfMonth !== undefined) {
        // Clamp to the last day so "day 31" fires on the 30th/28th, etc.
        const clamped = Math.min(config.dayOfMonth, daysInMonth(p.year, p.month));
        return p.day === clamped && timeReached;
      }
      return false;
    }
    case 'custom':
    case 'manual':
    default:
      return false;
  }
}
