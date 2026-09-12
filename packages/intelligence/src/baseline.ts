import { mean, stdDev } from './trend';
import type { MetricPeriod } from './types';
import type { DailyPoint, SnapshotDimension, SnapshotEngine, SnapshotMetric } from './snapshot-engine';

/**
 * Statistical baseline for a metric over a period (Etapa 11 — B2).
 *
 * Everything here is pure and works on daily points (usually from
 * `metric_snapshots`). The provider at the bottom wires it to the snapshot
 * engine and is injected into `RuleContext.baseline`, so rules can say
 * "R$ 42 mil vs. média de R$ 61 mil das últimas 4 semanas (z = −2,3)".
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimum history (days) to trust a baseline at all. */
export const MIN_BASELINE_DAYS = 14;
/** Reference window used for the moving baseline (4 weeks). */
export const REFERENCE_DAYS = 28;
/** Extra history to make rolling-sum distributions meaningful (12 weeks). */
export const HISTORY_DAYS = 84;

export type BaselineStats = {
  metric: string;
  period: { from: string; to: string };
  /** Days in the analysed period. */
  periodDays: number;
  /** Observed value over the period (sum or mean depending on metric). */
  current: number;
  /** Seasonality-adjusted expected value for the period (28d reference). */
  expected: number;
  /** Difference current − expected. */
  delta: number;
  /** Fractional deviation vs. expected (0.1 = +10%). */
  deviation: number;
  /** Z-score of the period vs. the distribution of same-length windows in history. */
  zScore: number | null;
  /** Mean daily value over the last 7 / 28 complete days before the period. */
  movingAvg7: number;
  movingAvg28: number;
  /** Daily standard deviation over the reference window. */
  dailyStdDev: number;
  /** Weekday multipliers (index 0 = Sunday). 1 = average day. */
  weekdayIndex: number[];
  /** Same period one year earlier, when history covers it. */
  yoy: { value: number; change: number } | null;
  businessDays: { period: number; expectedPerBusinessDay: number };
  /** Days of history that fed the baseline. */
  historyDays: number;
  /** Human reference for narratives: "média das últimas 4 semanas". */
  referenceLabel: string;
  /** True when |z| ≥ threshold (default 2). */
  isAnomaly: boolean;
  direction: 'above' | 'below' | 'normal';
};

export type BaselineOptions = {
  /** Sum daily values (revenue) or average them (rates). Default 'sum'. */
  aggregate?: 'sum' | 'mean';
  /** |z| that qualifies as anomaly. Default 2. */
  anomalyZ?: number;
  /** Same period last year (optional). */
  yoyDaily?: DailyPoint[] | null;
};

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS));
}

function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

export function countBusinessDays(period: MetricPeriod): number {
  let count = 0;
  for (let d = startOfUtcDay(period.from); d < period.to; d = new Date(d.getTime() + DAY_MS)) {
    if (isBusinessDay(d)) count += 1;
  }
  return count;
}

/** Zero-fill a daily series over [from, to). */
export function fillDaily(points: DailyPoint[], from: Date, to: Date): DailyPoint[] {
  const byDay = new Map(points.map((p) => [startOfUtcDay(p.date).getTime(), p.value]));
  const filled: DailyPoint[] = [];
  for (let d = startOfUtcDay(from); d < to; d = new Date(d.getTime() + DAY_MS)) {
    filled.push({ date: d, value: byDay.get(d.getTime()) ?? 0 });
  }
  return filled;
}

/**
 * Weekday seasonality index: mean of each weekday divided by the overall mean.
 * Returns all 1s when there is not enough data (< 2 full weeks).
 */
export function weekdaySeasonality(daily: DailyPoint[]): number[] {
  const flat = [1, 1, 1, 1, 1, 1, 1];
  if (daily.length < 14) return flat;
  const overall = mean(daily.map((p) => p.value));
  if (overall <= 0) return flat;

  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const point of daily) {
    const wd = point.date.getUTCDay();
    sums[wd] = (sums[wd] ?? 0) + point.value;
    counts[wd] = (counts[wd] ?? 0) + 1;
  }
  return sums.map((sum, wd) => {
    const count = counts[wd] ?? 0;
    if (count === 0) return 1;
    return sum / count / overall;
  });
}

/** Rolling sums (or means) of `window` consecutive days over a daily series. */
export function rollingAggregates(
  daily: DailyPoint[],
  window: number,
  aggregate: 'sum' | 'mean' = 'sum',
): number[] {
  if (window <= 0 || daily.length < window) return [];
  const values = daily.map((p) => p.value);
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i]!;
    if (i >= window) acc -= values[i - window]!;
    if (i >= window - 1) out.push(aggregate === 'sum' ? acc : acc / window);
  }
  return out;
}

/**
 * Compute the baseline for `period` given the daily history strictly before it
 * and the daily values inside the period.
 */
export function computeBaseline(input: {
  metric: string;
  period: MetricPeriod;
  /** Daily points strictly before period.from (ideally ≥ HISTORY_DAYS, zero-filled). */
  history: DailyPoint[];
  /** Daily points inside the period (zero-filled). */
  periodDaily: DailyPoint[];
  options?: BaselineOptions;
}): BaselineStats | null {
  const aggregate = input.options?.aggregate ?? 'sum';
  const anomalyZ = input.options?.anomalyZ ?? 2;

  const history = [...input.history].sort((a, b) => a.date.getTime() - b.date.getTime());
  if (history.length < MIN_BASELINE_DAYS) return null;

  const periodDays = daysBetween(input.period.from, input.period.to);
  const periodValues = input.periodDaily.map((p) => p.value);
  const current = aggregate === 'sum' ? periodValues.reduce((s, v) => s + v, 0) : mean(periodValues);

  const last7 = history.slice(-7);
  const last28 = history.slice(-REFERENCE_DAYS);
  const movingAvg7 = mean(last7.map((p) => p.value));
  const movingAvg28 = mean(last28.map((p) => p.value));
  const dailyStdDev = stdDev(last28.map((p) => p.value), movingAvg28);

  // Seasonality from the whole history, applied day by day to the period.
  const weekdayIndex = weekdaySeasonality(history);
  let expectedSum = 0;
  for (let d = startOfUtcDay(input.period.from); d < input.period.to; d = new Date(d.getTime() + DAY_MS)) {
    expectedSum += movingAvg28 * (weekdayIndex[d.getUTCDay()] ?? 1);
  }
  const expected = aggregate === 'sum' ? expectedSum : expectedSum / periodDays;

  // Distribution of same-length windows in history → z-score of the period.
  const windows = rollingAggregates(history, Math.min(periodDays, history.length), aggregate);
  let zScore: number | null = null;
  if (windows.length >= 4) {
    const avg = mean(windows);
    const sd = stdDev(windows, avg);
    if (sd > 0) zScore = (current - avg) / sd;
    else if (current !== avg) zScore = current > avg ? Infinity : -Infinity;
    else zScore = 0;
    if (!Number.isFinite(zScore)) zScore = Math.sign(zScore) * 10;
  }

  const delta = current - expected;
  const deviation = expected !== 0 ? delta / expected : current === 0 ? 0 : 1;

  let yoy: BaselineStats['yoy'] = null;
  const yoyDaily = input.options?.yoyDaily;
  if (yoyDaily && yoyDaily.length > 0) {
    const values = yoyDaily.map((p) => p.value);
    const value = aggregate === 'sum' ? values.reduce((s, v) => s + v, 0) : mean(values);
    if (value > 0) yoy = { value, change: (current - value) / value };
  }

  const businessDaysInPeriod = countBusinessDays(input.period);
  const referenceBusinessDays = last28.filter((p) => isBusinessDay(p.date)).length;
  const referenceBusinessSum = last28
    .filter((p) => isBusinessDay(p.date))
    .reduce((s, p) => s + p.value, 0);
  const expectedPerBusinessDay =
    referenceBusinessDays > 0 ? referenceBusinessSum / referenceBusinessDays : movingAvg28;

  const isAnomaly = zScore !== null && Math.abs(zScore) >= anomalyZ;
  const direction: BaselineStats['direction'] = isAnomaly
    ? (zScore as number) > 0
      ? 'above'
      : 'below'
    : 'normal';

  return {
    metric: input.metric,
    period: { from: input.period.from.toISOString(), to: input.period.to.toISOString() },
    periodDays,
    current: round4(current),
    expected: round4(expected),
    delta: round4(delta),
    deviation: round4(deviation),
    zScore: zScore === null ? null : Math.round(zScore * 100) / 100,
    movingAvg7: round4(movingAvg7),
    movingAvg28: round4(movingAvg28),
    dailyStdDev: round4(dailyStdDev),
    weekdayIndex: weekdayIndex.map((v) => Math.round(v * 1000) / 1000),
    yoy,
    businessDays: { period: businessDaysInPeriod, expectedPerBusinessDay: round4(expectedPerBusinessDay) },
    historyDays: history.length,
    referenceLabel:
      history.length >= REFERENCE_DAYS
        ? 'média das últimas 4 semanas'
        : `média dos últimos ${history.length} dias`,
    isAnomaly,
    direction,
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Provider (snapshot-backed)
// ---------------------------------------------------------------------------

export type BaselineQuery = {
  metric: SnapshotMetric;
  period: MetricPeriod;
  /** Baseline for one entity (e.g. revenue of a product). Defaults to tenant total. */
  entity?: { dimension: Exclude<SnapshotDimension, 'total'>; key: string };
  aggregate?: 'sum' | 'mean';
  anomalyZ?: number;
};

export interface BaselineProvider {
  /** Returns null when snapshots do not provide enough history. */
  forMetric(tenantId: string, query: BaselineQuery): Promise<BaselineStats | null>;
}

/** Rates are averaged, everything else summed. */
const MEAN_METRICS = new Set<string>(['average_ticket', 'gross_margin', 'cancellation_rate', 'refund_rate']);

export class SnapshotBaselineProvider implements BaselineProvider {
  constructor(private readonly snapshots: SnapshotEngine) {}

  async forMetric(tenantId: string, query: BaselineQuery): Promise<BaselineStats | null> {
    const periodFrom = startOfUtcDay(query.period.from);
    const historyFrom = new Date(periodFrom.getTime() - HISTORY_DAYS * DAY_MS);
    const dimension = query.entity?.dimension ?? 'total';
    const dimensionKey = query.entity?.key ?? '';
    const metric: SnapshotMetric = query.entity ? 'revenue' : query.metric;

    const coverage = await this.snapshots.coverage(tenantId);
    if (!coverage.first || !coverage.last) return null;
    const availableFrom = coverage.first > historyFrom ? coverage.first : historyFrom;
    if (daysBetween(availableFrom, periodFrom) < MIN_BASELINE_DAYS) return null;

    const yearAgoFrom = new Date(query.period.from.getTime() - 365 * DAY_MS);
    const yearAgoTo = new Date(query.period.to.getTime() - 365 * DAY_MS);
    const hasYoy = coverage.first <= startOfUtcDay(yearAgoFrom);

    const [historyRaw, periodRaw, yoyRaw] = await Promise.all([
      this.snapshots.getDaily(tenantId, metric, availableFrom, periodFrom, dimension, dimensionKey),
      this.snapshots.getDaily(tenantId, metric, periodFrom, query.period.to, dimension, dimensionKey),
      hasYoy
        ? this.snapshots.getDaily(tenantId, metric, yearAgoFrom, yearAgoTo, dimension, dimensionKey)
        : Promise.resolve(null),
    ]);

    return computeBaseline({
      metric: query.entity ? `revenue:${dimension}` : query.metric,
      period: query.period,
      history: fillDaily(historyRaw, availableFrom, periodFrom),
      periodDaily: fillDaily(periodRaw, periodFrom, query.period.to),
      options: {
        aggregate: query.aggregate ?? (MEAN_METRICS.has(query.metric) ? 'mean' : 'sum'),
        anomalyZ: query.anomalyZ,
        yoyDaily: yoyRaw ? fillDaily(yoyRaw, startOfUtcDay(yearAgoFrom), yearAgoTo) : null,
      },
    });
  }
}

/** Provider that never has history — used in tests and when snapshots are disabled. */
export const NULL_BASELINE_PROVIDER: BaselineProvider = {
  forMetric: async () => null,
};

/** Short pt-BR reference sentence for narratives. */
export function describeBaseline(
  stats: BaselineStats,
  format: (value: number) => string,
): string {
  const z = stats.zScore === null ? '' : ` (z = ${stats.zScore.toFixed(1).replace('.', ',')})`;
  const yoy =
    stats.yoy && Number.isFinite(stats.yoy.change)
      ? `; ${stats.yoy.change >= 0 ? '+' : ''}${Math.round(stats.yoy.change * 100)}% vs. mesmo período do ano anterior`
      : '';
  return `${format(stats.current)} vs. ${format(stats.expected)} esperado pela ${stats.referenceLabel}${z}${yoy}`;
}
