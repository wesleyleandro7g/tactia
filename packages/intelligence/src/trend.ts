/**
 * Pure time-series helpers shared by get_trend, baseline and forecast.
 * No I/O here — everything is deterministic and unit-testable.
 */

export type SeriesPoint = { bucket: string; value: number };

export type TrendAnomaly = SeriesPoint & {
  expected: number;
  zScore: number;
  direction: 'above' | 'below';
};

export type TrendSummary = {
  points: SeriesPoint[];
  movingAverage: Array<{ bucket: string; value: number | null }>;
  anomalies: TrendAnomaly[];
  /** Least-squares slope per bucket, in metric units. */
  slope: number;
  /** slope relative to the mean (0.02 = +2% per bucket). */
  slopePerBucket: number;
  /** Second half vs first half of the window. */
  halfOverHalfChange: number | null;
  mean: number;
  stdDev: number;
  min: SeriesPoint | null;
  max: SeriesPoint | null;
  direction: 'up' | 'down' | 'flat';
};

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function stdDev(values: number[], avg = mean(values)): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function zScore(value: number, avg: number, sd: number): number {
  if (sd === 0) return value === avg ? 0 : value > avg ? Infinity : -Infinity;
  return (value - avg) / sd;
}

export function movingAverage(values: number[], window: number): Array<number | null> {
  return values.map((_, index) => {
    if (index + 1 < window) return null;
    const slice = values.slice(index + 1 - window, index + 1);
    return mean(slice);
  });
}

export function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - xMean) * ((values[i] ?? 0) - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Anomalies: points whose z-score against the trailing window (excluding the
 * point itself) exceeds `threshold`. Needs at least `minHistory` prior points.
 */
export function detectAnomalies(
  points: SeriesPoint[],
  options: { window?: number; threshold?: number; minHistory?: number } = {},
): TrendAnomaly[] {
  const window = options.window ?? 7;
  const threshold = options.threshold ?? 2;
  const minHistory = options.minHistory ?? 4;
  const anomalies: TrendAnomaly[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const history = points.slice(Math.max(0, i - window), i).map((p) => p.value);
    if (history.length < minHistory) continue;
    const avg = mean(history);
    const sd = stdDev(history, avg);
    if (sd === 0) continue;
    const point = points[i]!;
    const z = zScore(point.value, avg, sd);
    if (Math.abs(z) >= threshold) {
      anomalies.push({
        ...point,
        expected: avg,
        zScore: Math.round(z * 100) / 100,
        direction: z > 0 ? 'above' : 'below',
      });
    }
  }
  return anomalies;
}

export function summarizeTrend(
  points: SeriesPoint[],
  options: { window?: number; anomalyThreshold?: number } = {},
): TrendSummary {
  const values = points.map((p) => p.value);
  const window = options.window ?? 7;
  const avg = mean(values);
  const sd = stdDev(values, avg);
  const slope = linearSlope(values);
  const ma = movingAverage(values, window);

  const half = Math.floor(points.length / 2);
  const first = values.slice(0, half);
  const second = values.slice(points.length - half);
  const firstSum = first.reduce((s, v) => s + v, 0);
  const secondSum = second.reduce((s, v) => s + v, 0);
  const halfOverHalf = half === 0 || firstSum === 0 ? null : (secondSum - firstSum) / firstSum;

  let min: SeriesPoint | null = null;
  let max: SeriesPoint | null = null;
  for (const point of points) {
    if (!min || point.value < min.value) min = point;
    if (!max || point.value > max.value) max = point;
  }

  const slopePerBucket = avg === 0 ? 0 : slope / avg;
  const direction: TrendSummary['direction'] =
    Math.abs(slopePerBucket) < 0.01 ? 'flat' : slopePerBucket > 0 ? 'up' : 'down';

  return {
    points,
    movingAverage: points.map((p, i) => ({ bucket: p.bucket, value: ma[i] ?? null })),
    anomalies: detectAnomalies(points, { window, threshold: options.anomalyThreshold }),
    slope,
    slopePerBucket,
    halfOverHalfChange: halfOverHalf,
    mean: avg,
    stdDev: sd,
    min,
    max,
    direction,
  };
}

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

export type Granularity = 'day' | 'week' | 'month';

export function startOfBucket(date: Date, granularity: Granularity): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (granularity === 'day') return d;
  if (granularity === 'week') {
    // ISO week: Monday
    const day = d.getUTCDay();
    const diff = (day + 6) % 7;
    d.setUTCDate(d.getUTCDate() - diff);
    return d;
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addBuckets(date: Date, granularity: Granularity, count: number): Date {
  const d = new Date(date);
  if (granularity === 'day') d.setUTCDate(d.getUTCDate() + count);
  else if (granularity === 'week') d.setUTCDate(d.getUTCDate() + 7 * count);
  else d.setUTCMonth(d.getUTCMonth() + count);
  return d;
}

/** Contiguous buckets covering [from, to). */
export function bucketsBetween(from: Date, to: Date, granularity: Granularity): Array<{ from: Date; to: Date }> {
  const buckets: Array<{ from: Date; to: Date }> = [];
  let cursor = startOfBucket(from, granularity);
  if (cursor < from) cursor = new Date(from);
  while (cursor < to) {
    const next = addBuckets(startOfBucket(cursor, granularity), granularity, 1);
    buckets.push({ from: cursor, to: next < to ? next : to });
    cursor = next;
  }
  return buckets;
}

export function bucketLabel(date: Date, granularity: Granularity): string {
  const iso = date.toISOString().slice(0, 10);
  return granularity === 'month' ? iso.slice(0, 7) : iso;
}
