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
 * Validates a single cron field for SYNTAX (independently of any value): every
 * token must be `*`, a bare number, a range, or either with a `*​/step`, all
 * within `[min, max]`. Mirrors the parsing rules of `matchesCronField`.
 */
function isValidCronField(field: string, min: number, max: number): boolean {
  const inRange = (n: number) => Number.isInteger(n) && n >= min && n <= max;

  for (const part of field.split(',')) {
    const token = part.trim();
    if (token === '') return false;

    const [rangeRaw, stepRaw, ...rest] = token.split('/');
    if (rest.length > 0 || rangeRaw === undefined) return false;

    if (stepRaw !== undefined) {
      const step = Number(stepRaw);
      if (!Number.isInteger(step) || step <= 0) return false;
    }

    if (rangeRaw === '*') continue;
    if (rangeRaw.includes('-')) {
      const [a, b, ...more] = rangeRaw.split('-');
      if (more.length > 0 || a === undefined || b === undefined) return false;
      const start = Number(a);
      const end = Number(b);
      if (!inRange(start) || !inRange(end) || start > end) return false;
    } else {
      if (!inRange(Number(rangeRaw))) return false;
    }
  }
  return true;
}

/**
 * Validates a standard 5-field cron expression's syntax. Day-of-week accepts
 * 0..7 (both 0 and 7 mean Sunday). Returns false for anything the scheduler
 * cannot evaluate, so callers can reject it at creation time.
 */
export function isValidCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  return (
    isValidCronField(minute, 0, 59) &&
    isValidCronField(hour, 0, 23) &&
    isValidCronField(dom, 1, 31) &&
    isValidCronField(month, 1, 12) &&
    isValidCronField(dow, 0, 7)
  );
}

// ---------------------------------------------------------------------------
// Cron matching (custom frequency)
// ---------------------------------------------------------------------------

/**
 * Matches a single standard cron field against a numeric value. Supports the
 * subset used by schedules: `*`, lists (`1,2`), ranges (`1-5`), steps (`*​/5`,
 * `1-30/5`) and any combination separated by commas. `min`/`max` bound the
 * field (e.g. 0..59 for minutes) so ranges/steps stay within domain.
 *
 * Returns `false` on any malformed token: an invalid cron never fires
 * automatically, which is safer than firing on every tick.
 */
export function matchesCronField(field: string, value: number, min: number, max: number): boolean {
  const clampError = (n: number) => Number.isNaN(n) || n < min || n > max;

  for (const part of field.split(',')) {
    const token = part.trim();
    if (token === '') return false;

    // Split off an optional step: "range/step" or "*​/step".
    const [rangeRaw, stepRaw, ...rest] = token.split('/');
    if (rest.length > 0) return false; // more than one '/' is malformed
    if (rangeRaw === undefined) return false;

    let step = 1;
    if (stepRaw !== undefined) {
      step = Number(stepRaw);
      if (!Number.isInteger(step) || step <= 0) return false;
    }

    let start: number;
    let end: number;
    if (rangeRaw === '*') {
      start = min;
      end = max;
    } else if (rangeRaw.includes('-')) {
      const [a, b, ...more] = rangeRaw.split('-');
      if (more.length > 0 || a === undefined || b === undefined) return false;
      start = Number(a);
      end = Number(b);
      if (clampError(start) || clampError(end) || start > end) return false;
    } else {
      const single = Number(rangeRaw);
      if (clampError(single)) return false;
      // A bare number ignores step (step only meaningful with a range or '*').
      if (value === single) return true;
      continue;
    }

    if (value < start || value > end) continue;
    if ((value - start) % step === 0) return true;
  }
  return false;
}

/**
 * Evaluates a standard 5-field cron expression (`min hour dom month dow`)
 * against wall-clock parts. Day-of-month is 1..31, month 1..12, day-of-week
 * 0..6 (0=Sunday; 7 is normalized to 0). Per POSIX cron, when BOTH day-of-month
 * and day-of-week are restricted (neither is `*`), the match is a UNION (either
 * one satisfies); otherwise it is an intersection.
 */
export function matchesCron(expression: string, parts: LocalParts): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];

  const minuteOk = matchesCronField(minute, parts.minute, 0, 59);
  const hourOk = matchesCronField(hour, parts.hour, 0, 23);
  const monthOk = matchesCronField(month, parts.month, 1, 12);
  if (!minuteOk || !hourOk || !monthOk) return false;

  // Normalize dow: cron allows 7 for Sunday; LocalParts uses 0=Sun..6=Sat.
  const dowValue = parts.weekday;
  const domRestricted = dom.trim() !== '*';
  const dowRestricted = dow.trim() !== '*';
  const domOk = matchesCronField(dom, parts.day, 1, 31);
  const dowOk = matchesCronField(dow, dowValue, 0, 6) || matchesCronField(dow, dowValue === 0 ? 7 : dowValue, 0, 7);

  if (domRestricted && dowRestricted) return domOk || dowOk;
  if (domRestricted) return domOk;
  if (dowRestricted) return dowOk;
  return true; // both '*'
}

/**
 * Whether the schedule should fire for the period containing `now`. Idempotency
 * (not firing twice in the same period) is handled by the occurrence store; this
 * only answers "is this the right day/time?".
 *
 * `custom` evaluates the cron expression in the schedule's timezone. The tick
 * runs every 5 minutes, so cron cadence is effectively floored to that
 * resolution; the minute-granular `periodKey` guarantees at most one run per
 * matched minute. `manual` never fires automatically.
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
    case 'custom': {
      if (!recurrence.cronExpression) return false;
      return matchesCron(recurrence.cronExpression, p);
    }
    case 'manual':
    default:
      return false;
  }
}
