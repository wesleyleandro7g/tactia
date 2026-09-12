import { createId } from '@tactia/shared';
import type { PrismaClient } from '@tactia/database';
import { MetricEngine } from './metric-engine';
import type { MetricKey, MetricPeriod } from './types';
import {
  bucketLabel,
  startOfBucket,
  addBuckets,
  type Granularity,
  type SeriesPoint,
} from './trend';
import type { SeriesProvider } from './analytics-engine';

/**
 * Daily materialization of metrics into `metric_snapshots` (Etapa 11).
 *
 * Snapshots are the source of truth for trends, baselines and forecasts:
 * reading 90 rows is much cheaper (and more stable) than re-aggregating
 * `sales` for every window. Growth metrics are derived, so they are not
 * snapshotted; everything else is materialized per UTC day.
 */

/** Metrics materialized per day (growth metrics are derived and excluded). */
export const SNAPSHOT_METRICS = [
  'revenue',
  'sales_count',
  'units_sold',
  'average_ticket',
  'discount_total',
  'gross_margin',
  'complaint_count',
  'new_customers',
  'pending_amount',
  'cancellation_rate',
  'refund_rate',
] as const satisfies readonly MetricKey[];

export type SnapshotMetric = (typeof SNAPSHOT_METRICS)[number];

export const SNAPSHOT_DIMENSIONS = ['total', 'product', 'seller', 'category', 'customer'] as const;
export type SnapshotDimension = (typeof SNAPSHOT_DIMENSIONS)[number];

/** Breakdown dimensions materialized daily (revenue only). */
const BREAKDOWN_DIMENSIONS = ['product', 'seller', 'category', 'customer'] as const;

/** How to roll daily values up to weeks/months. */
const AGGREGATION: Record<SnapshotMetric, 'sum' | 'mean' | 'ratio'> = {
  revenue: 'sum',
  sales_count: 'sum',
  units_sold: 'sum',
  average_ticket: 'ratio', // revenue / sales_count
  discount_total: 'sum',
  gross_margin: 'mean', // weighted by revenue
  complaint_count: 'sum',
  new_customers: 'sum',
  pending_amount: 'sum',
  cancellation_rate: 'mean',
  refund_rate: 'mean',
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function decimalToNumber(v: { toNumber(): number } | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return v.toNumber();
}

export function isSnapshotMetric(key: string): key is SnapshotMetric {
  return (SNAPSHOT_METRICS as readonly string[]).includes(key);
}

export type SnapshotRow = {
  metricKey: string;
  dimension: SnapshotDimension;
  dimensionKey: string;
  bucketDate: Date;
  value: number;
};

export type MaterializeResult = {
  /** Number of UTC days (re)computed. */
  days: number;
  /** Rows written. */
  rows: number;
  from: Date | null;
  to: Date | null;
};

export type SnapshotRunResult = MaterializeResult & {
  /** True when this run computed the full history (first execution). */
  backfilled: boolean;
};

export type SnapshotRunOptions = {
  now?: Date;
  /** Days re-materialized on every run to absorb late-arriving data. Default 3. */
  recomputeDays?: number;
  /** Hard cap for backfill length. Default 730 days. */
  maxBackfillDays?: number;
  /** Concurrency for per-day computation. Default 4. */
  concurrency?: number;
};

export type DailyPoint = { date: Date; value: number };

export class SnapshotEngine {
  private readonly metrics: MetricEngine;

  constructor(
    private readonly db: PrismaClient,
    metricEngine?: MetricEngine,
  ) {
    this.metrics = metricEngine ?? new MetricEngine(db);
  }

  // -------------------------------------------------------------------------
  // Write side
  // -------------------------------------------------------------------------

  /**
   * Incremental run: backfills from the first sale on first execution, then
   * recomputes the trailing `recomputeDays` (default 3) up to today.
   */
  async run(tenantId: string, options: SnapshotRunOptions = {}): Promise<SnapshotRunResult> {
    const now = options.now ?? new Date();
    const recomputeDays = Math.max(1, options.recomputeDays ?? 3);
    const maxBackfillDays = options.maxBackfillDays ?? 730;
    const today = startOfUtcDay(now);

    const last = await this.db.metricSnapshot.findFirst({
      where: { tenantId, dimension: 'total' },
      orderBy: { bucketDate: 'desc' },
      select: { bucketDate: true },
    });

    let from: Date;
    let backfilled = false;

    if (last) {
      from = addDays(startOfUtcDay(last.bucketDate), -(recomputeDays - 1));
    } else {
      const firstSale = await this.db.sale.findFirst({
        where: { tenantId },
        orderBy: { soldAt: 'asc' },
        select: { soldAt: true },
      });
      if (!firstSale) {
        return { days: 0, rows: 0, from: null, to: null, backfilled: false };
      }
      from = startOfUtcDay(firstSale.soldAt);
      const earliest = addDays(today, -maxBackfillDays);
      if (from < earliest) from = earliest;
      backfilled = true;
    }

    const result = await this.materialize(tenantId, from, addDays(today, 1), {
      concurrency: options.concurrency,
    });
    return { ...result, backfilled };
  }

  /**
   * (Re)compute every UTC day in [from, to). Existing rows for those days are
   * replaced atomically per day.
   */
  async materialize(
    tenantId: string,
    from: Date,
    to: Date,
    options: { concurrency?: number } = {},
  ): Promise<MaterializeResult> {
    const start = startOfUtcDay(from);
    const end = startOfUtcDay(to);
    if (end <= start) return { days: 0, rows: 0, from: null, to: null };

    const days: Date[] = [];
    for (let cursor = start; cursor < end; cursor = addDays(cursor, 1)) days.push(cursor);

    const concurrency = Math.max(1, options.concurrency ?? 4);
    let rows = 0;

    for (let i = 0; i < days.length; i += concurrency) {
      const batch = days.slice(i, i + concurrency);
      const counts = await Promise.all(batch.map((day) => this.materializeDay(tenantId, day)));
      rows += counts.reduce((sum, n) => sum + n, 0);
    }

    return { days: days.length, rows, from: start, to: end };
  }

  private async materializeDay(tenantId: string, day: Date): Promise<number> {
    const period: MetricPeriod = { from: day, to: addDays(day, 1) };
    const rows = await this.computeDay(tenantId, period);

    await this.db.$transaction([
      this.db.metricSnapshot.deleteMany({ where: { tenantId, bucketDate: day } }),
      this.db.metricSnapshot.createMany({
        data: rows.map((row) => ({
          id: createId(),
          tenantId,
          metricKey: row.metricKey,
          dimension: row.dimension,
          dimensionKey: row.dimensionKey,
          bucketDate: row.bucketDate,
          value: row.value,
        })),
      }),
    ]);

    return rows.length;
  }

  /** Pure-ish: computes the rows for one day without writing (used by tests). */
  async computeDay(tenantId: string, period: MetricPeriod): Promise<SnapshotRow[]> {
    const day = startOfUtcDay(period.from);

    const [totals, breakdowns] = await Promise.all([
      Promise.all(
        SNAPSHOT_METRICS.map(async (key) => {
          const result = await this.metrics.calculate(key, { tenantId, period });
          return { key, value: result.value };
        }),
      ),
      Promise.all(
        BREAKDOWN_DIMENSIONS.map(async (dimension) => {
          const result = await this.metrics.calculate('revenue', {
            tenantId,
            period,
            breakdown: { dimension },
          });
          return { dimension, items: result.breakdown?.items ?? [] };
        }),
      ),
    ]);

    const rows: SnapshotRow[] = totals.map(({ key, value }) => ({
      metricKey: key,
      dimension: 'total',
      dimensionKey: '',
      bucketDate: day,
      value: Number.isFinite(value) ? value : 0,
    }));

    for (const { dimension, items } of breakdowns) {
      for (const item of items) {
        if (!item.key || item.value === 0) continue;
        rows.push({
          metricKey: 'revenue',
          dimension,
          dimensionKey: item.key,
          bucketDate: day,
          value: item.value,
        });
      }
    }

    return rows;
  }

  // -------------------------------------------------------------------------
  // Read side
  // -------------------------------------------------------------------------

  /** First/last materialized day for the tenant (totals). */
  async coverage(tenantId: string): Promise<{ first: Date | null; last: Date | null }> {
    const [first, last] = await Promise.all([
      this.db.metricSnapshot.findFirst({
        where: { tenantId, dimension: 'total' },
        orderBy: { bucketDate: 'asc' },
        select: { bucketDate: true },
      }),
      this.db.metricSnapshot.findFirst({
        where: { tenantId, dimension: 'total' },
        orderBy: { bucketDate: 'desc' },
        select: { bucketDate: true },
      }),
    ]);
    return {
      first: first ? startOfUtcDay(first.bucketDate) : null,
      last: last ? startOfUtcDay(last.bucketDate) : null,
    };
  }

  /** Daily values for a metric (optionally for one entity of a dimension) in [from, to). */
  async getDaily(
    tenantId: string,
    metric: SnapshotMetric,
    from: Date,
    to: Date,
    dimension: SnapshotDimension = 'total',
    dimensionKey = '',
  ): Promise<DailyPoint[]> {
    const rows = await this.db.metricSnapshot.findMany({
      where: {
        tenantId,
        metricKey: metric,
        dimension,
        dimensionKey,
        bucketDate: { gte: startOfUtcDay(from), lt: startOfUtcDay(to) },
      },
      orderBy: { bucketDate: 'asc' },
      select: { bucketDate: true, value: true },
    });
    return rows.map((row) => ({
      date: startOfUtcDay(row.bucketDate),
      value: decimalToNumber(row.value),
    }));
  }

  /**
   * Daily values of a dimension (e.g. revenue per product) for every entity,
   * keyed by `dimensionKey`. Used by RFM/cohorts and per-entity baselines.
   */
  async getDailyByDimension(
    tenantId: string,
    dimension: Exclude<SnapshotDimension, 'total'>,
    from: Date,
    to: Date,
  ): Promise<Map<string, DailyPoint[]>> {
    const rows = await this.db.metricSnapshot.findMany({
      where: {
        tenantId,
        metricKey: 'revenue',
        dimension,
        bucketDate: { gte: startOfUtcDay(from), lt: startOfUtcDay(to) },
      },
      orderBy: { bucketDate: 'asc' },
      select: { dimensionKey: true, bucketDate: true, value: true },
    });
    const byKey = new Map<string, DailyPoint[]>();
    for (const row of rows) {
      const list = byKey.get(row.dimensionKey) ?? [];
      list.push({ date: startOfUtcDay(row.bucketDate), value: decimalToNumber(row.value) });
      byKey.set(row.dimensionKey, list);
    }
    return byKey;
  }

  /**
   * Series in the shape expected by `AnalyticsEngine` (contiguous buckets, zero
   * filled). Returns `null` when snapshots do not cover the window so callers
   * fall back to live aggregation.
   */
  async getSeries(
    tenantId: string,
    metric: MetricKey,
    from: Date,
    to: Date,
    granularity: Granularity,
    options: { now?: Date } = {},
  ): Promise<SeriesPoint[] | null> {
    if (!isSnapshotMetric(metric)) return null;

    const coverage = await this.coverage(tenantId);
    if (!coverage.first || !coverage.last) return null;

    const now = options.now ?? new Date();
    const windowStart = startOfUtcDay(from);
    // The last complete day we expect materialized: yesterday (or the window end).
    const requiredLast = addDays(startOfUtcDay(new Date(Math.min(to.getTime(), now.getTime()))), -1);
    if (coverage.first > windowStart || coverage.last < requiredLast) return null;

    const aggregation = AGGREGATION[metric];
    const [daily, revenueDaily, countDaily] = await Promise.all([
      this.getDaily(tenantId, metric, from, to),
      aggregation === 'sum' ? Promise.resolve([]) : this.getDaily(tenantId, 'revenue', from, to),
      aggregation === 'ratio' ? this.getDaily(tenantId, 'sales_count', from, to) : Promise.resolve([]),
    ]);

    const revenueByDay = new Map(revenueDaily.map((p) => [p.date.getTime(), p.value]));
    const countByDay = new Map(countDaily.map((p) => [p.date.getTime(), p.value]));

    type Acc = { sum: number; weight: number; count: number; revenue: number; sales: number };
    const buckets = new Map<number, Acc>();

    for (const point of daily) {
      const bucket = startOfBucket(point.date, granularity).getTime();
      const acc = buckets.get(bucket) ?? { sum: 0, weight: 0, count: 0, revenue: 0, sales: 0 };
      const dayRevenue = revenueByDay.get(point.date.getTime()) ?? 0;
      acc.sum += point.value;
      acc.count += 1;
      acc.weight += point.value * dayRevenue;
      acc.revenue += dayRevenue;
      acc.sales += countByDay.get(point.date.getTime()) ?? 0;
      buckets.set(bucket, acc);
    }

    const series: SeriesPoint[] = [];
    let cursor = startOfBucket(windowStart, granularity);
    const end = startOfUtcDay(to);
    while (cursor < end) {
      const acc = buckets.get(cursor.getTime());
      let value = 0;
      if (acc) {
        if (aggregation === 'sum') value = acc.sum;
        else if (aggregation === 'ratio') value = acc.sales > 0 ? acc.revenue / acc.sales : 0;
        else if (metric === 'gross_margin' && acc.revenue > 0) value = acc.weight / acc.revenue;
        else value = acc.count > 0 ? acc.sum / acc.count : 0;
      }
      series.push({ bucket: bucketLabel(cursor, granularity), value: round4(value) });
      cursor = addBuckets(cursor, granularity, 1);
    }

    return series;
  }

  /** Adapter for `AnalyticsEngine.useSeriesProvider`. */
  seriesProvider(): SeriesProvider {
    return (input) =>
      this.getSeries(input.tenantId, input.metric, input.from, input.to, input.granularity);
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
