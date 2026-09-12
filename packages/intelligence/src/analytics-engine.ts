import type { PrismaClient } from '@tactia/database';
import { MetricEngine } from './metric-engine';
import {
  DEFAULT_THRESHOLDS,
  METRIC_KEYS,
  type DecompositionDimension,
  type Drivers,
  type MetricDimension,
  type MetricKey,
  type MetricPeriod,
  type MetricResult,
  periodIso,
  type TenantThresholds,
} from './types';
import { decomposeChange, isDecomposable } from './variance-decomposition';
import {
  bucketLabel,
  bucketsBetween,
  summarizeTrend,
  type Granularity,
  type SeriesPoint,
  type TrendSummary,
} from './trend';
import { HISTORY_DAYS, fillDaily } from './baseline';
import { forecastDaily, forecastPeriodTotal, MIN_FORECAST_DAYS, type DailyForecast } from './forecast';
import { startOfUtcDay, type DailyPoint } from './snapshot-engine';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Metrics that are averaged (not summed) across days. */
const RATE_METRICS = new Set<string>(['average_ticket', 'gross_margin', 'cancellation_rate', 'refund_rate']);

/** Pluggable series source (snapshots when available, live metrics otherwise). */
export type SeriesProvider = (input: {
  tenantId: string;
  metric: MetricKey;
  from: Date;
  to: Date;
  granularity: Granularity;
}) => Promise<SeriesPoint[] | null>;

function decimalToNumber(v: { toNumber(): number } | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return v.toNumber();
}

function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function goalWindow(periodType: string, start: Date): MetricPeriod {
  const from = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const to = new Date(from);
  if (periodType === 'year') to.setUTCFullYear(to.getUTCFullYear() + 1);
  else if (periodType === 'quarter') to.setUTCMonth(to.getUTCMonth() + 3);
  else to.setUTCMonth(to.getUTCMonth() + 1);
  return { from, to };
}

function previousPeriod(p: MetricPeriod): MetricPeriod {
  const duration = p.to.getTime() - p.from.getTime();
  return {
    from: new Date(p.from.getTime() - duration),
    to: new Date(p.to.getTime() - duration),
  };
}

function excerpt(body: string, max = 200): string {
  const trimmed = body.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export type AnalyticsInput = {
  tenantId: string;
  period: MetricPeriod;
  thresholds?: Partial<TenantThresholds>;
};

export class AnalyticsEngine {
  private readonly metrics: MetricEngine;
  private seriesProvider: SeriesProvider | null = null;

  constructor(private readonly db: PrismaClient) {
    this.metrics = new MetricEngine(db);
  }

  /** Register a faster series source (metric snapshots). Falls back to live metrics. */
  useSeriesProvider(provider: SeriesProvider | null) {
    this.seriesProvider = provider;
  }

  // -------------------------------------------------------------------------
  // Comparative analysis (Insights v2)
  // -------------------------------------------------------------------------

  /**
   * Compare a metric between two arbitrary periods, optionally broken down by
   * a dimension (contributors ranked by absolute change).
   */
  async comparePeriods(
    tenantId: string,
    metric: MetricKey,
    periodA: MetricPeriod,
    periodB: MetricPeriod,
    dimension?: Exclude<MetricDimension, 'time'>,
    limit = 10,
  ) {
    const [a, b] = await Promise.all([
      this.metrics.calculate(metric, {
        tenantId,
        period: periodA,
        ...(dimension ? { breakdown: { dimension } } : {}),
      }),
      this.metrics.calculate(metric, {
        tenantId,
        period: periodB,
        ...(dimension ? { breakdown: { dimension } } : {}),
      }),
    ]);

    const delta = a.value - b.value;
    const change = b.value === 0 ? (a.value === 0 ? 0 : 1) : delta / b.value;

    let breakdown:
      | Array<{
          key: string;
          label: string;
          valueA: number;
          valueB: number;
          delta: number;
          change: number | null;
        }>
      | undefined;
    if (dimension) {
      const mapB = new Map((b.breakdown?.items ?? []).map((item) => [item.key, item]));
      const keys = new Set<string>([
        ...(a.breakdown?.items ?? []).map((item) => item.key),
        ...mapB.keys(),
      ]);
      const mapA = new Map((a.breakdown?.items ?? []).map((item) => [item.key, item]));
      breakdown = [...keys]
        .map((key) => {
          const itemA = mapA.get(key);
          const itemB = mapB.get(key);
          const valueA = itemA?.value ?? 0;
          const valueB = itemB?.value ?? 0;
          return {
            key,
            label: itemA?.label ?? itemB?.label ?? key,
            valueA,
            valueB,
            delta: valueA - valueB,
            change: valueB === 0 ? null : (valueA - valueB) / valueB,
          };
        })
        .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
        .slice(0, limit);
    }

    return {
      metric,
      periodA: { ...periodIso(periodA), value: a.value },
      periodB: { ...periodIso(periodB), value: b.value },
      delta,
      change,
      ...(dimension ? { dimension, breakdown } : {}),
      evidence: [a, b] as MetricResult[],
    };
  }

  /** Root-cause decomposition of a metric change (see variance-decomposition.ts). */
  async explainChange(
    tenantId: string,
    metric: string,
    period: MetricPeriod,
    comparePeriod?: MetricPeriod,
    options: { dimensions?: DecompositionDimension[]; topN?: number; currency?: string } = {},
  ): Promise<Drivers> {
    if (!isDecomposable(metric)) {
      throw new Error(
        `A métrica '${metric}' não pode ser decomposta. Métricas suportadas: revenue, sales_count, units_sold, discount_total, gross_margin.`,
      );
    }
    return decomposeChange(this.db, {
      tenantId,
      metric,
      period,
      ...(comparePeriod ? { comparePeriod } : {}),
      ...(options.dimensions ? { dimensions: options.dimensions } : {}),
      ...(options.topN ? { topN: options.topN } : {}),
      ...(options.currency ? { currency: options.currency } : {}),
    });
  }

  /** Time series of a metric with moving average and anomalies. */
  async getTrend(
    tenantId: string,
    metric: MetricKey,
    options: { from: Date; to: Date; granularity?: Granularity; anomalyThreshold?: number },
  ): Promise<TrendSummary & { metric: MetricKey; granularity: Granularity; source: 'snapshots' | 'live' }> {
    const granularity = options.granularity ?? 'day';
    let points: SeriesPoint[] | null = null;
    let source: 'snapshots' | 'live' = 'live';

    if (this.seriesProvider) {
      points = await this.seriesProvider({
        tenantId,
        metric,
        from: options.from,
        to: options.to,
        granularity,
      });
      if (points) source = 'snapshots';
    }

    if (!points) {
      const buckets = bucketsBetween(options.from, options.to, granularity).slice(-120);
      const results = await Promise.all(
        buckets.map((bucket) => this.metrics.calculate(metric, { tenantId, period: bucket })),
      );
      points = buckets.map((bucket, index) => ({
        bucket: bucketLabel(bucket.from, granularity),
        value: results[index]?.value ?? 0,
      }));
    }

    const window = granularity === 'day' ? 7 : granularity === 'week' ? 4 : 3;
    const summary = summarizeTrend(points, {
      window,
      anomalyThreshold: options.anomalyThreshold,
    });
    return { ...summary, metric, granularity, source };
  }

  static isMetricKey(value: string): value is MetricKey {
    return (METRIC_KEYS as readonly string[]).includes(value);
  }

  async getCustomerProfile(
    tenantId: string,
    customerId: string,
    period: MetricPeriod,
  ) {
    const customer = await this.db.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
    });
    if (!customer) return null;

    const sales = await this.db.sale.findMany({
      where: { tenantId, customerId, status: 'confirmed' },
      orderBy: { soldAt: 'desc' },
      include: { items: { include: { product: { select: { id: true, name: true } } } } },
      take: 20,
    });

    const ltv = sales.reduce((sum, sale) => sum + decimalToNumber(sale.totalAmount), 0);
    const lastSale = sales[0] ?? null;
    const daysSinceLastPurchase = lastSale
      ? Math.floor((Date.now() - lastSale.soldAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;

    const productTotals = new Map<string, { name: string; revenue: number }>();
    for (const sale of sales) {
      for (const item of sale.items) {
        const current = productTotals.get(item.productId) ?? {
          name: item.product.name,
          revenue: 0,
        };
        current.revenue += decimalToNumber(item.totalAmount);
        productTotals.set(item.productId, current);
      }
    }
    const topProducts = [...productTotals.entries()]
      .map(([productId, data]) => ({ productId, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const [interactions, activities, leads] = await Promise.all([
      this.db.interaction.findMany({
        where: { tenantId, customerId },
        orderBy: { occurredAt: 'desc' },
        take: 8,
        select: {
          id: true,
          channel: true,
          intent: true,
          occurredAt: true,
          body: true,
          topics: true,
        },
      }),
      this.db.activity.findMany({
        where: { tenantId, customerId },
        orderBy: { occurredAt: 'desc' },
        take: 8,
        select: { id: true, type: true, occurredAt: true, sellerId: true },
      }),
      this.db.lead.findMany({
        where: { tenantId, customerId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, status: true, score: true, source: true },
      }),
    ]);

    const periodSales = sales.filter(
      (sale) => sale.soldAt >= period.from && sale.soldAt < period.to,
    );
    const periodRevenue = periodSales.reduce(
      (sum, sale) => sum + decimalToNumber(sale.totalAmount),
      0,
    );

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        status: customer.status,
        createdAt: customer.createdAt.toISOString(),
      },
      lifetime: {
        totalSales: sales.length,
        ltv,
        lastPurchaseAt: lastSale?.soldAt.toISOString() ?? null,
        daysSinceLastPurchase,
        topProducts,
      },
      period: {
        ...periodIso(period),
        salesCount: periodSales.length,
        revenue: periodRevenue,
      },
      interactions: interactions.map((item) => ({
        id: item.id,
        channel: item.channel,
        intent: item.intent,
        occurredAt: item.occurredAt.toISOString(),
        excerpt: excerpt(item.body),
        topics: item.topics,
      })),
      activities: activities.map((item) => ({
        id: item.id,
        type: item.type,
        occurredAt: item.occurredAt.toISOString(),
        sellerId: item.sellerId,
      })),
      leads: leads.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        score: item.score,
        source: item.source,
      })),
    };
  }

  async getPipeline(
    tenantId: string,
    options: {
      inactiveLeadDays?: number;
      hotLeadScore?: number;
      limit?: number;
    } = {},
  ) {
    const thresholds = { ...DEFAULT_THRESHOLDS, ...options };
    const cutoff = new Date(Date.now() - thresholds.inactiveLeadDays * 24 * 60 * 60 * 1000);
    const limit = options.limit ?? 20;

    const leads = await this.db.lead.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    const byStatus = new Map<string, number>();
    const bySource = new Map<string, { total: number; won: number; lost: number }>();
    let won = 0;
    let lost = 0;

    for (const lead of leads) {
      byStatus.set(lead.status, (byStatus.get(lead.status) ?? 0) + 1);
      const source = lead.source ?? 'Desconhecida';
      const bucket = bySource.get(source) ?? { total: 0, won: 0, lost: 0 };
      bucket.total += 1;
      if (lead.status === 'won') {
        won += 1;
        bucket.won += 1;
      }
      if (lead.status === 'lost') {
        lost += 1;
        bucket.lost += 1;
      }
      bySource.set(source, bucket);
    }

    const activeLeadIds = leads
      .filter((lead) => !['won', 'lost'].includes(lead.status))
      .map((lead) => lead.id);

    const recentActivities =
      activeLeadIds.length > 0
        ? await this.db.activity.findMany({
            where: {
              tenantId,
              leadId: { in: activeLeadIds },
              occurredAt: { gte: cutoff },
            },
            select: { leadId: true },
          })
        : [];

    const activeLeadSet = new Set(
      recentActivities.map((activity) => activity.leadId).filter(Boolean),
    );

    const stalledHotLeads = leads
      .filter(
        (lead) =>
          !['won', 'lost'].includes(lead.status) &&
          (lead.score ?? 0) >= thresholds.hotLeadScore &&
          !activeLeadSet.has(lead.id),
      )
      .slice(0, limit)
      .map((lead) => ({
        id: lead.id,
        name: lead.name,
        status: lead.status,
        score: lead.score,
        source: lead.source,
      }));

    const inactiveLeads = leads
      .filter((lead) => !['won', 'lost'].includes(lead.status) && !activeLeadSet.has(lead.id))
      .slice(0, limit)
      .map((lead) => ({
        id: lead.id,
        name: lead.name,
        status: lead.status,
        score: lead.score,
        source: lead.source,
      }));

    const conversionBySource = [...bySource.entries()].map(([source, stats]) => ({
      source,
      total: stats.total,
      won: stats.won,
      lost: stats.lost,
      winRate: stats.won + stats.lost > 0 ? stats.won / (stats.won + stats.lost) : 0,
    }));

    return {
      totals: {
        leads: leads.length,
        won,
        lost,
        active: leads.filter((lead) => !['won', 'lost'].includes(lead.status)).length,
        winRate: won + lost > 0 ? won / (won + lost) : 0,
      },
      byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
      conversionBySource,
      stalledHotLeads,
      inactiveLeads,
    };
  }

  async getDataFreshness(tenantId: string, staleHours = DEFAULT_THRESHOLDS.staleDataHours) {
    const sources = await this.db.dataSource.findMany({
      where: { tenantId, status: { not: 'inactive' } },
      orderBy: { name: 'asc' },
    });

    const now = Date.now();
    const items = [];

    for (const source of sources) {
      const latestJob = await this.db.syncJob.findFirst({
        where: { tenantId, dataSourceId: source.id },
        orderBy: { createdAt: 'desc' },
      });
      const latestReport = await this.db.dataQualityReport.findFirst({
        where: { tenantId, dataSourceId: source.id },
        orderBy: { createdAt: 'desc' },
      });

      const lastSyncAt = source.lastSyncAt ?? latestJob?.finishedAt ?? null;
      const ageHours =
        lastSyncAt == null ? null : (now - lastSyncAt.getTime()) / (60 * 60 * 1000);

      items.push({
        id: source.id,
        name: source.name,
        type: source.type,
        status: source.status,
        lastSyncAt: lastSyncAt?.toISOString() ?? null,
        ageHours,
        isStale: ageHours != null ? ageHours > staleHours : true,
        latestSyncJob: latestJob
          ? {
              id: latestJob.id,
              status: latestJob.status,
              recordsFailed: latestJob.recordsFailed,
              error: latestJob.error,
              finishedAt: latestJob.finishedAt?.toISOString() ?? null,
            }
          : null,
        latestQualityReport: latestReport
          ? {
              id: latestReport.id,
              entityType: latestReport.entityType,
              totalRecords: latestReport.totalRecords,
              invalidRecords: latestReport.invalidRecords,
              createdAt: latestReport.createdAt.toISOString(),
            }
          : null,
      });
    }

    return {
      staleThresholdHours: staleHours,
      sources: items,
      staleCount: items.filter((item) => item.isStale).length,
    };
  }

  async getPeriodProjection(tenantId: string, period: MetricPeriod) {
    const now = new Date();
    const elapsedMs = Math.min(now.getTime(), period.to.getTime()) - period.from.getTime();
    const totalMs = period.to.getTime() - period.from.getTime();
    const elapsedDays = Math.max(1, elapsedMs / (24 * 60 * 60 * 1000));
    const totalDays = Math.max(1, totalMs / (24 * 60 * 60 * 1000));
    const remainingDays = Math.max(0, (period.to.getTime() - Math.min(now.getTime(), period.to.getTime())) / (24 * 60 * 60 * 1000));

    const [revenue, salesCount] = await Promise.all([
      this.metrics.calculate('revenue', { tenantId, period }),
      this.metrics.calculate('sales_count', { tenantId, period }),
    ]);

    const prev = previousPeriod(period);
    const [prevRevenue, prevSalesCount] = await Promise.all([
      this.metrics.calculate('revenue', { tenantId, period: prev }),
      this.metrics.calculate('sales_count', { tenantId, period: prev }),
    ]);

    const dailyRevenue = revenue.value / elapsedDays;
    const dailySales = salesCount.value / elapsedDays;
    const projectedRevenue = dailyRevenue * totalDays;
    const projectedSales = dailySales * totalDays;

    // Seasonal Holt forecast for the rest of the period (falls back to the
    // linear run-rate when there is no daily history).
    const historyFrom = new Date(period.from.getTime() - HISTORY_DAYS * DAY_MS);
    const [revenueHistory, salesHistory] = await Promise.all([
      this.dailyHistory(tenantId, 'revenue', historyFrom, now),
      this.dailyHistory(tenantId, 'sales_count', historyFrom, now),
    ]);
    const revenueForecast = forecastPeriodTotal({
      history: revenueHistory,
      actualToDate: revenue.value,
      period,
      now,
    });
    const salesForecast = forecastPeriodTotal({
      history: salesHistory,
      actualToDate: salesCount.value,
      period,
      now,
    });
    const useForecast = revenueForecast.method !== 'linear';
    const revenueExpected = useForecast ? revenueForecast.projected.expected : projectedRevenue;
    const salesExpected = useForecast ? salesForecast.projected.expected : projectedSales;

    return {
      period: periodIso(period),
      elapsedDays: Math.round(elapsedDays * 10) / 10,
      remainingDays: Math.round(remainingDays * 10) / 10,
      totalDays: Math.round(totalDays * 10) / 10,
      current: {
        revenue: revenue.value,
        salesCount: salesCount.value,
      },
      previousPeriod: {
        revenue: prevRevenue.value,
        salesCount: prevSalesCount.value,
      },
      projection: {
        method: useForecast ? revenueForecast.method : 'linear',
        confidence: useForecast ? revenueForecast.confidence : 0.3,
        revenue: {
          expected: revenueExpected,
          low: useForecast ? revenueForecast.projected.low : projectedRevenue,
          high: useForecast ? revenueForecast.projected.high : projectedRevenue,
        },
        salesCount: {
          expected: salesExpected,
          low: useForecast ? salesForecast.projected.low : projectedSales,
          high: useForecast ? salesForecast.projected.high : projectedSales,
        },
        revenueLinear: projectedRevenue,
        salesLinear: projectedSales,
        revenueGapVsPrevious: revenueExpected - prevRevenue.value,
        salesGapVsPrevious: salesExpected - prevSalesCount.value,
        historyDays: revenueForecast.historyDays,
      },
    };
  }

  /**
   * Daily forecast for a metric over the next `horizonDays` (default 30),
   * with P10/P90 band. Uses snapshots when available, else live daily buckets.
   */
  async getForecast(
    tenantId: string,
    metric: MetricKey,
    options: { horizonDays?: number; now?: Date; historyDays?: number } = {},
  ): Promise<
    DailyForecast & {
      metric: MetricKey;
      from: string;
      to: string;
      source: 'snapshots' | 'live';
      /** Same horizon immediately before `from`, for comparison. */
      previous: { value: number; change: number | null };
    }
  > {
    const now = options.now ?? new Date();
    const horizonDays = Math.max(1, Math.min(120, options.horizonDays ?? 30));
    const historyDays = Math.max(MIN_FORECAST_DAYS, options.historyDays ?? HISTORY_DAYS);
    const today = startOfUtcDay(now);
    const historyFrom = new Date(today.getTime() - historyDays * DAY_MS);

    const { points, source } = await this.dailyHistoryWithSource(tenantId, metric, historyFrom, today);
    const aggregate = RATE_METRICS.has(metric) ? 'mean' : 'sum';
    const forecast = forecastDaily(points, today, horizonDays, { aggregate });

    const previousWindow = points.slice(-horizonDays);
    const previousValue =
      aggregate === 'mean'
        ? previousWindow.length > 0
          ? previousWindow.reduce((s, p) => s + p.value, 0) / previousWindow.length
          : 0
        : previousWindow.reduce((s, p) => s + p.value, 0);
    const change = previousValue > 0 ? (forecast.total.expected - previousValue) / previousValue : null;

    return {
      ...forecast,
      metric,
      from: today.toISOString(),
      to: new Date(today.getTime() + horizonDays * DAY_MS).toISOString(),
      source,
      previous: { value: previousValue, change },
    };
  }

  /** Zero-filled daily history for [from, to) — snapshots first, live fallback. */
  private async dailyHistory(
    tenantId: string,
    metric: MetricKey,
    from: Date,
    to: Date,
  ): Promise<DailyPoint[]> {
    return (await this.dailyHistoryWithSource(tenantId, metric, from, to)).points;
  }

  private async dailyHistoryWithSource(
    tenantId: string,
    metric: MetricKey,
    from: Date,
    to: Date,
  ): Promise<{ points: DailyPoint[]; source: 'snapshots' | 'live' }> {
    const start = startOfUtcDay(from);
    const end = startOfUtcDay(to);
    if (end <= start) return { points: [], source: 'live' };

    let series: SeriesPoint[] | null = null;
    if (this.seriesProvider) {
      series = await this.seriesProvider({ tenantId, metric, from: start, to: end, granularity: 'day' });
    }
    let source: 'snapshots' | 'live' = 'snapshots';
    if (!series) {
      source = 'live';
      // Live fallback: one aggregate per day, capped to keep it cheap.
      const buckets = bucketsBetween(start, end, 'day').slice(-HISTORY_DAYS);
      const results = await Promise.all(
        buckets.map((bucket) => this.metrics.calculate(metric, { tenantId, period: bucket })),
      );
      series = buckets.map((bucket, index) => ({
        bucket: bucketLabel(bucket.from, 'day'),
        value: results[index]?.value ?? 0,
      }));
    }

    const points: DailyPoint[] = series.map((point) => ({
      date: new Date(`${point.bucket}T00:00:00.000Z`),
      value: point.value,
    }));
    return { points: fillDaily(points, start, end), source };
  }

  async getProductPerformance(tenantId: string, period: MetricPeriod, limit = 10) {
    type ProductRow = {
      product_id: string;
      name: string;
      category: string | null;
      revenue: string;
      units: string;
      discount: string;
      margin: string | null;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any).$queryRaw`
      SELECT
        p.id AS product_id,
        p.name,
        p.category,
        COALESCE(SUM(si.total_amount), 0)::text AS revenue,
        COALESCE(SUM(si.quantity), 0)::text AS units,
        COALESCE(SUM(si.discount_amount), 0)::text AS discount,
        CASE
          WHEN p.cost IS NULL THEN NULL
          ELSE (COALESCE(SUM(si.total_amount), 0) - COALESCE(SUM(si.quantity * p.cost), 0))::text
        END AS margin
      FROM products p
      LEFT JOIN sale_items si ON si.product_id = p.id
        AND si.tenant_id = ${tenantId}::uuid
      LEFT JOIN sales s ON s.id = si.sale_id
        AND s.status = 'confirmed'
        AND s.sold_at >= ${period.from}
        AND s.sold_at < ${period.to}
      WHERE p.tenant_id = ${tenantId}::uuid
        AND p.deleted_at IS NULL
      GROUP BY p.id, p.name, p.category, p.cost
      ORDER BY revenue DESC
      LIMIT ${limit}
    `) as ProductRow[];

    const categoryBreakdown = await this.metrics.calculate('revenue', {
      tenantId,
      period,
      breakdown: { dimension: 'category' },
    });

    const unsoldActive = await this.db.product.count({
      where: {
        tenantId,
        status: 'active',
        deletedAt: null,
        saleItems: {
          none: {
            sale: {
              status: 'confirmed',
              soldAt: { gte: period.from, lt: period.to },
            },
          },
        },
      },
    });

    return {
      period: periodIso(period),
      ranking: rows.map((row, index) => ({
        position: index + 1,
        productId: row.product_id,
        name: row.name,
        category: row.category,
        revenue: parseFloat(row.revenue),
        units: parseFloat(row.units),
        discount: parseFloat(row.discount),
        grossMargin: row.margin == null ? null : parseFloat(row.margin),
      })),
      categoryBreakdown: categoryBreakdown.breakdown?.items ?? [],
      unsoldActiveProducts: unsoldActive,
    };
  }

  async getSalesHealth(tenantId: string, period: MetricPeriod) {
    const keys = [
      'revenue',
      'discount_total',
      'cancellation_rate',
      'refund_rate',
      'pending_amount',
    ] as const;

    const results = await Promise.all(
      keys.map((key) =>
        this.metrics.calculate(key, { tenantId, period, withComparison: true }),
      ),
    );

    const byStatus = await this.db.sale.groupBy({
      by: ['status'],
      where: {
        tenantId,
        soldAt: { gte: period.from, lt: period.to },
        status: { in: ['confirmed', 'pending', 'cancelled', 'refunded'] },
      },
      _sum: { totalAmount: true },
      _count: { id: true },
    });

    const unassigned = await this.db.sale.count({
      where: {
        tenantId,
        status: 'confirmed',
        sellerId: null,
        soldAt: { gte: period.from, lt: period.to },
      },
    });

    const revenue = results.find((result) => result.key === 'revenue')!;
    const discount = results.find((result) => result.key === 'discount_total')!;
    const discountShare =
      revenue.value + discount.value === 0
        ? 0
        : discount.value / (revenue.value + discount.value);

    return {
      period: periodIso(period),
      metrics: Object.fromEntries(results.map((result) => [result.key, result])),
      discountShare,
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: row._count.id,
        amount: decimalToNumber(row._sum.totalAmount),
      })),
      unassignedSales: unassigned,
    };
  }

  async getSellerPerformance(tenantId: string, period: MetricPeriod, limit = 10) {
    type SellerRow = {
      seller_id: string;
      name: string;
      revenue: string;
      sales_count: string;
      discount: string;
      customers: string;
      activities: string;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any).$queryRaw`
      SELECT
        sel.id AS seller_id,
        sel.name,
        COALESCE(SUM(s.total_amount), 0)::text AS revenue,
        COUNT(s.id)::text AS sales_count,
        COALESCE(SUM(s.discount_amount), 0)::text AS discount,
        COUNT(DISTINCT s.customer_id)::text AS customers,
        (
          SELECT COUNT(*)::text
          FROM activities a
          WHERE a.tenant_id = ${tenantId}::uuid
            AND a.seller_id = sel.id
            AND a.occurred_at >= ${period.from}
            AND a.occurred_at < ${period.to}
        ) AS activities
      FROM sellers sel
      LEFT JOIN sales s ON s.seller_id = sel.id
        AND s.tenant_id = ${tenantId}::uuid
        AND s.status = 'confirmed'
        AND s.sold_at >= ${period.from}
        AND s.sold_at < ${period.to}
      WHERE sel.tenant_id = ${tenantId}::uuid
        AND sel.deleted_at IS NULL
      GROUP BY sel.id, sel.name
      ORDER BY revenue DESC
      LIMIT ${limit}
    `) as SellerRow[];

    const prev = previousPeriod(period);
    const prevRevenue = await this.metrics.calculate('revenue', {
      tenantId,
      period: prev,
      breakdown: { dimension: 'seller' },
    });
    const prevMap = new Map(
      (prevRevenue.breakdown?.items ?? []).map((item) => [item.key, item.value]),
    );

    return {
      period: periodIso(period),
      ranking: rows.map((row, index) => {
        const revenue = parseFloat(row.revenue);
        const salesCount = parseInt(row.sales_count, 10);
        const previous = prevMap.get(row.seller_id) ?? 0;
        return {
          position: index + 1,
          sellerId: row.seller_id,
          name: row.name,
          revenue,
          salesCount,
          averageTicket: salesCount === 0 ? 0 : revenue / salesCount,
          discount: parseFloat(row.discount),
          uniqueCustomers: parseInt(row.customers, 10),
          activities: parseInt(row.activities, 10),
          revenueChange: previous === 0 ? (revenue === 0 ? 0 : 1) : (revenue - previous) / previous,
        };
      }),
    };
  }

  async getCustomerVoice(tenantId: string, period: MetricPeriod, limit = 10) {
    const interactions = await this.db.interaction.findMany({
      where: {
        tenantId,
        occurredAt: { gte: period.from, lt: period.to },
      },
      orderBy: { occurredAt: 'desc' },
      take: 500,
      select: {
        id: true,
        channel: true,
        direction: true,
        intent: true,
        topics: true,
        sentiment: true,
        urgency: true,
        productId: true,
        customerId: true,
        occurredAt: true,
        body: true,
      },
    });

    const prev = previousPeriod(period);
    const prevInteractions = await this.db.interaction.findMany({
      where: {
        tenantId,
        occurredAt: { gte: prev.from, lt: prev.to },
      },
      select: { intent: true, topics: true, sentiment: true },
    });

    const countBy = (items: Array<{ intent: string | null }>, key: string | null) =>
      items.filter((item) => item.intent === key).length;

    const NEGATIVE_INTENTS = new Set([
      'complaint',
      'delivery_issue',
      'price_objection',
      'cancellation_intent',
    ]);
    const currentComplaints = countBy(interactions, 'complaint');
    const currentPraise = countBy(interactions, 'praise');
    const prevComplaints = countBy(prevInteractions, 'complaint');
    const currentNegative = interactions.filter(
      (item) => item.intent && NEGATIVE_INTENTS.has(item.intent),
    ).length;
    const prevNegative = prevInteractions.filter(
      (item) => item.intent && NEGATIVE_INTENTS.has(item.intent),
    ).length;

    const sentimentValues = interactions
      .map((item) => (item.sentiment == null ? null : decimalToNumber(item.sentiment)))
      .filter((value): value is number => value != null);
    const prevSentimentValues = prevInteractions
      .map((item) => (item.sentiment == null ? null : decimalToNumber(item.sentiment)))
      .filter((value): value is number => value != null);
    const avg = (values: number[]) =>
      values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;

    const topicCounts = new Map<string, number>();
    for (const item of interactions) {
      for (const topic of item.topics) {
        topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
      }
    }
    const topTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([topic, count]) => ({ topic, count }));

    const INTENTS = [
      'complaint',
      'delivery_issue',
      'price_objection',
      'cancellation_intent',
      'purchase_intent',
      'support',
      'question',
      'praise',
      'other',
    ];
    const byIntent = INTENTS.map((intent) => ({
      intent,
      count: interactions.filter((item) => item.intent === intent).length,
    })).filter((entry) => entry.count > 0);
    const byChannel = ['whatsapp', 'email', 'note', 'other'].map((channel) => ({
      channel,
      count: interactions.filter((item) => item.channel === channel).length,
    }));

    // Per product: negatives, sentiment, top intents.
    const productIds = [...new Set(interactions.map((i) => i.productId).filter((id): id is string => !!id))];
    const products =
      productIds.length > 0
        ? await this.db.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true },
          })
        : [];
    const productNames = new Map(products.map((p) => [p.id, p.name]));
    const byProductMap = new Map<
      string,
      { productId: string; name: string; interactions: number; negative: number; sentiments: number[] }
    >();
    for (const item of interactions) {
      if (!item.productId) continue;
      const entry = byProductMap.get(item.productId) ?? {
        productId: item.productId,
        name: productNames.get(item.productId) ?? 'Produto',
        interactions: 0,
        negative: 0,
        sentiments: [],
      };
      entry.interactions += 1;
      if (item.intent && NEGATIVE_INTENTS.has(item.intent)) entry.negative += 1;
      if (item.sentiment != null) entry.sentiments.push(decimalToNumber(item.sentiment));
      byProductMap.set(item.productId, entry);
    }
    const byProduct = [...byProductMap.values()]
      .map((entry) => ({
        productId: entry.productId,
        name: entry.name,
        interactions: entry.interactions,
        negative: entry.negative,
        avgSentiment: avg(entry.sentiments),
      }))
      .sort((a, b) => b.negative - a.negative || b.interactions - a.interactions)
      .slice(0, limit);

    const urgent = interactions
      .filter((item) => item.urgency === 'high')
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        intent: item.intent,
        channel: item.channel,
        customerId: item.customerId,
        occurredAt: item.occurredAt.toISOString(),
        excerpt: excerpt(item.body),
      }));

    const samples = interactions
      .filter((item) => item.intent && item.intent !== 'other' && item.intent !== 'question')
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        intent: item.intent,
        channel: item.channel,
        sentiment: item.sentiment == null ? null : decimalToNumber(item.sentiment),
        urgency: item.urgency,
        occurredAt: item.occurredAt.toISOString(),
        excerpt: excerpt(item.body),
      }));

    const purchaseIntents = countBy(interactions, 'purchase_intent');
    const cancellationIntents = countBy(interactions, 'cancellation_intent');

    return {
      period: periodIso(period),
      totals: {
        interactions: interactions.length,
        complaints: currentComplaints,
        praise: currentPraise,
        negative: currentNegative,
        negativeChange:
          prevNegative === 0 ? (currentNegative === 0 ? 0 : 1) : (currentNegative - prevNegative) / prevNegative,
        purchaseIntents,
        cancellationIntents,
        urgent: interactions.filter((item) => item.urgency === 'high').length,
        avgSentiment: avg(sentimentValues),
        previousAvgSentiment: avg(prevSentimentValues),
        complaintChange:
          prevComplaints === 0
            ? currentComplaints === 0
              ? 0
              : 1
            : (currentComplaints - prevComplaints) / prevComplaints,
        praiseToComplaintRatio:
          currentComplaints === 0 ? currentPraise : currentPraise / currentComplaints,
      },
      byIntent,
      byChannel,
      byProduct,
      topTopics,
      urgent,
      samples,
    };
  }

  async getCustomerSegments(tenantId: string, period: MetricPeriod, limit = 10) {
    type CustomerRow = {
      customer_id: string;
      name: string;
      revenue: string;
      sales_count: string;
      last_purchase: Date | null;
      first_purchase: Date | null;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any).$queryRaw`
      SELECT
        c.id AS customer_id,
        c.name,
        COALESCE(SUM(s.total_amount), 0)::text AS revenue,
        COUNT(s.id)::text AS sales_count,
        MAX(s.sold_at) AS last_purchase,
        MIN(s.sold_at) AS first_purchase
      FROM customers c
      LEFT JOIN sales s ON s.customer_id = c.id
        AND s.tenant_id = ${tenantId}::uuid
        AND s.status = 'confirmed'
      WHERE c.tenant_id = ${tenantId}::uuid
        AND c.deleted_at IS NULL
      GROUP BY c.id, c.name
      ORDER BY revenue DESC
    `) as CustomerRow[];

    const now = Date.now();
    const periodCustomers = new Set<string>();
    const periodSales = await this.db.sale.findMany({
      where: {
        tenantId,
        status: 'confirmed',
        soldAt: { gte: period.from, lt: period.to },
      },
      select: { customerId: true },
    });
    for (const sale of periodSales) periodCustomers.add(sale.customerId);

    type EnrichedCustomer = {
      customerId: string;
      name: string;
      revenue: number;
      salesCount: number;
      lastPurchaseAt: string | null;
      daysSinceLastPurchase: number | null;
      avgPurchaseIntervalDays: number | null;
      churnRisk: boolean;
      isNewInPeriod: boolean;
      isRepeatInPeriod: boolean;
    };

    const enriched: EnrichedCustomer[] = rows.map((row) => {
      const revenue = parseFloat(row.revenue);
      const salesCount = parseInt(row.sales_count, 10);
      const lastPurchase = row.last_purchase;
      const firstPurchase = row.first_purchase;
      const daysSinceLast =
        lastPurchase == null
          ? null
          : Math.floor((now - lastPurchase.getTime()) / (24 * 60 * 60 * 1000));
      const avgInterval =
        salesCount > 1 && firstPurchase && lastPurchase
          ? (lastPurchase.getTime() - firstPurchase.getTime()) / (salesCount - 1) /
            (24 * 60 * 60 * 1000)
          : null;
      const churnRisk =
        avgInterval != null &&
        daysSinceLast != null &&
        daysSinceLast > avgInterval * DEFAULT_THRESHOLDS.churnIntervalFactor;

      return {
        customerId: row.customer_id,
        name: row.name,
        revenue,
        salesCount,
        lastPurchaseAt: lastPurchase?.toISOString() ?? null,
        daysSinceLastPurchase: daysSinceLast,
        avgPurchaseIntervalDays: avgInterval,
        churnRisk,
        isNewInPeriod: periodCustomers.has(row.customer_id) && salesCount <= 1,
        isRepeatInPeriod: periodCustomers.has(row.customer_id) && salesCount > 1,
      };
    });

    const totalRevenue = enriched.reduce((sum, row) => sum + row.revenue, 0);
    let cumulative = 0;
    const concentration = enriched.map((row) => {
      cumulative += row.revenue;
      return {
        customerId: row.customerId,
        name: row.name,
        revenue: row.revenue,
        cumulativeShare: totalRevenue === 0 ? 0 : cumulative / totalRevenue,
      };
    });

    return {
      period: periodIso(period),
      totals: {
        customers: enriched.length,
        activeInPeriod: periodCustomers.size,
        newInPeriod: enriched.filter((row) => row.isNewInPeriod).length,
        repeatInPeriod: enriched.filter((row) => row.isRepeatInPeriod).length,
        churnRisk: enriched.filter((row) => row.churnRisk).length,
      },
      churnRiskCustomers: enriched.filter((row) => row.churnRisk).slice(0, limit),
      topCustomers: enriched.slice(0, limit),
      concentration: concentration.slice(0, limit),
    };
  }

  async getProductAffinity(tenantId: string, period: MetricPeriod, limit = 10) {
    type PairRow = {
      product_a_id: string;
      product_a_name: string;
      product_b_id: string;
      product_b_name: string;
      co_occurrences: string;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any).$queryRaw`
      SELECT
        p1.id AS product_a_id,
        p1.name AS product_a_name,
        p2.id AS product_b_id,
        p2.name AS product_b_name,
        COUNT(*)::text AS co_occurrences
      FROM sale_items si1
      INNER JOIN sale_items si2 ON si1.sale_id = si2.sale_id
        AND si1.product_id < si2.product_id
      INNER JOIN sales s ON s.id = si1.sale_id
      INNER JOIN products p1 ON p1.id = si1.product_id
      INNER JOIN products p2 ON p2.id = si2.product_id
      WHERE si1.tenant_id = ${tenantId}::uuid
        AND s.status = 'confirmed'
        AND s.sold_at >= ${period.from}
        AND s.sold_at < ${period.to}
      GROUP BY p1.id, p1.name, p2.id, p2.name
      ORDER BY co_occurrences DESC
      LIMIT ${limit}
    `) as PairRow[];

    return {
      period: periodIso(period),
      pairs: rows.map((row, index) => ({
        position: index + 1,
        productA: { id: row.product_a_id, name: row.product_a_name },
        productB: { id: row.product_b_id, name: row.product_b_name },
        coOccurrences: parseInt(row.co_occurrences, 10),
      })),
    };
  }

  async getGoalsProgress(tenantId: string, now = new Date()) {
    const goals = await this.db.goal.findMany({ where: { tenantId }, orderBy: { periodStart: 'desc' } });
    const tenant = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
    return Promise.all(
      goals.map(async (goal) => {
        const period = goalWindow(goal.periodType, goal.periodStart);
        const metric = (METRIC_KEYS as readonly string[]).includes(goal.metricKey)
          ? await this.metrics.calculate(goal.metricKey as MetricKey, { tenantId, period })
          : { key: goal.metricKey, value: 0, period: periodIso(period) };
        const target = Number(goal.target);
        const achieved = metric.value;
        const elapsed = Math.min(1, Math.max(0, (now.getTime() - period.from.getTime()) / (period.to.getTime() - period.from.getTime())));
        const required = target * elapsed;
        const remainingDays = Math.max(0, (period.to.getTime() - now.getTime()) / DAY_MS);
        const remaining = Math.max(0, target - achieved);
        const requiredDailyPace = remainingDays > 0 ? remaining / remainingDays : remaining;
        const onTrack = target <= 0 ? true : achieved >= required * (1 - 0.1);
        return {
          id: goal.id,
          metricKey: goal.metricKey,
          scope: goal.scope,
          scopeId: goal.scopeId,
          periodType: goal.periodType,
          period: periodIso(period),
          periodEnd: period.to.toISOString(),
          target,
          achieved,
          progress: target > 0 ? achieved / target : 0,
          requiredDailyPace,
          projected: goal.metricKey === 'revenue' ? (await this.getPeriodProjection(tenantId, period)).projection.revenue.expected : null,
          onTrack,
          currency: tenant?.currency ?? 'BRL',
        };
      }),
    );
  }

  async getFunnel(tenantId: string, period: MetricPeriod) {
    const stages = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'] as const;
    const [leads, transitions] = await Promise.all([
      this.db.lead.groupBy({ by: ['status'], where: { tenantId }, _count: { id: true } }),
      this.db.leadStageTransition.findMany({
        where: { tenantId, occurredAt: { gte: period.from, lt: period.to } },
        select: { leadId: true, fromStatus: true, toStatus: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
        take: 5000,
      }),
    ]);
    const countByStatus = Object.fromEntries(stages.map((s) => [s, 0])) as Record<string, number>;
    for (const row of leads) countByStatus[row.status] = row._count.id;

    const times: Record<string, number[]> = {};
    const byLead = new Map<string, typeof transitions>();
    for (const t of transitions) {
      const list = byLead.get(t.leadId) ?? [];
      list.push(t);
      byLead.set(t.leadId, list);
    }
    for (const list of byLead.values()) {
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1]!;
        const curr = list[i]!;
        const days = (curr.occurredAt.getTime() - prev.occurredAt.getTime()) / DAY_MS;
        (times[prev.toStatus] ??= []).push(days);
      }
    }

    const stalled = await this.db.lead.findMany({
      where: {
        tenantId,
        status: { notIn: ['won', 'lost'] },
        updatedAt: { lt: new Date(period.to.getTime() - 14 * DAY_MS) },
      },
      select: { id: true, name: true, status: true, source: true, sellerId: true, updatedAt: true },
      take: 20,
    });

    return {
      period: periodIso(period),
      stages: stages.map((status, index) => {
        const next = stages[index + 1];
        const current = countByStatus[status] ?? 0;
        const following = next ? (countByStatus[next] ?? 0) : 0;
        return {
          status,
          count: current,
          conversionToNext: current > 0 && next ? following / current : null,
          avgDays: meanOrNull(times[status] ?? []),
        };
      }),
      stalled,
      createdInPeriod: await this.db.lead.count({
        where: { tenantId, createdAt: { gte: period.from, lt: period.to } },
      }),
    };
  }

  async getCohorts(tenantId: string) {
    const sales = await this.db.sale.findMany({
      where: { tenantId, status: 'confirmed' },
      select: { customerId: true, soldAt: true, totalAmount: true },
      orderBy: { soldAt: 'asc' },
      take: 20_000,
    });
    const firstMonth = new Map<string, string>();
    const months = new Set<string>();
    for (const sale of sales) {
      const month = sale.soldAt.toISOString().slice(0, 7);
      months.add(month);
      if (!firstMonth.has(sale.customerId)) firstMonth.set(sale.customerId, month);
    }
    const monthList = [...months].sort();
    const cohorts = monthList.map((cohort) => {
      const members = [...firstMonth.entries()].filter(([, m]) => m === cohort).map(([id]) => id);
      const retention = monthList.map((month) => {
        if (month < cohort) return null;
        const active = new Set(
          sales.filter((s) => s.soldAt.toISOString().slice(0, 7) === month && members.includes(s.customerId)).map((s) => s.customerId),
        );
        return members.length === 0 ? 0 : active.size / members.length;
      });
      return { cohort, size: members.length, retention };
    });
    return { months: monthList, cohorts };
  }

  async getRfm(tenantId: string, now = new Date()) {
    const sales = await this.db.sale.findMany({
      where: { tenantId, status: 'confirmed' },
      select: { customerId: true, soldAt: true, totalAmount: true, customer: { select: { name: true } } },
      take: 20_000,
    });
    const byCustomer = new Map<string, { name: string; last: Date; count: number; monetary: number }>();
    for (const sale of sales) {
      const row = byCustomer.get(sale.customerId) ?? {
        name: sale.customer.name,
        last: sale.soldAt,
        count: 0,
        monetary: 0,
      };
      row.count += 1;
      row.monetary += Number(sale.totalAmount);
      if (sale.soldAt > row.last) row.last = sale.soldAt;
      byCustomer.set(sale.customerId, row);
    }
    const rows = [...byCustomer.entries()].map(([id, row]) => ({
      customerId: id,
      name: row.name,
      recencyDays: (now.getTime() - row.last.getTime()) / DAY_MS,
      frequency: row.count,
      monetary: row.monetary,
    }));
    const score = (values: number[], invert = false) => {
      const sorted = [...values].sort((a, b) => a - b);
      return (value: number) => {
        const rank = sorted.findIndex((v) => v >= value);
        const q = Math.min(5, Math.floor(((rank < 0 ? sorted.length : rank) / Math.max(1, sorted.length)) * 5) + 1);
        return invert ? 6 - q : q;
      };
    };
    const rScore = score(rows.map((r) => r.recencyDays), true);
    const fScore = score(rows.map((r) => r.frequency));
    const mScore = score(rows.map((r) => r.monetary));
    const labeled = rows.map((row) => {
      const r = rScore(row.recencyDays);
      const f = fScore(row.frequency);
      const m = mScore(row.monetary);
      let label = 'regular';
      if (r >= 4 && f >= 4 && m >= 4) label = 'champion';
      else if (r <= 2 && f >= 4) label = 'at_risk';
      else if (r <= 2 && f <= 2) label = 'hibernating';
      return { ...row, r, f, m, label };
    });
    return {
      totals: {
        customers: labeled.length,
        champions: labeled.filter((r) => r.label === 'champion').length,
        atRisk: labeled.filter((r) => r.label === 'at_risk').length,
        hibernating: labeled.filter((r) => r.label === 'hibernating').length,
      },
      customers: labeled.sort((a, b) => b.monetary - a.monetary).slice(0, 50),
    };
  }

  async simulate(
    tenantId: string,
    scenario: { recoverCustomers?: number; discountShare?: number; goalId?: string },
    period: MetricPeriod,
  ) {
    const [health, ticket] = await Promise.all([
      this.getSalesHealth(tenantId, period),
      this.metrics.calculate('average_ticket', { tenantId, period }),
    ]);
    const recoverN = scenario.recoverCustomers ?? 0;
    const recoveredRevenue = recoverN * ticket.value;
    const currentDiscountShare = health.discountShare ?? 0;
    const targetShare = scenario.discountShare ?? currentDiscountShare;
    const discountTotal = health.metrics.discount_total?.value ?? 0;
    const discountSavings =
      currentDiscountShare > 0 ? discountTotal * (1 - targetShare / currentDiscountShare) : 0;
    let goal: { target: number; projected: number; gap: number } | null = null;
    if (scenario.goalId) {
      const progress = await this.getGoalsProgress(tenantId);
      const found = progress.find((g) => g.id === scenario.goalId);
      if (found) {
        goal = {
          target: found.target,
          projected: (found.projected ?? found.achieved) + recoveredRevenue + discountSavings,
          gap: found.target - ((found.projected ?? found.achieved) + recoveredRevenue + discountSavings),
        };
      }
    }
    return {
      assumptions: { recoverCustomers: recoverN, averageTicket: ticket.value, discountShare: targetShare },
      effects: { recoveredRevenue, discountSavings, total: recoveredRevenue + discountSavings },
      goal,
    };
  }

  async getProfitability(tenantId: string, period: MetricPeriod) {
    const [revenue, margin, expenses, profit, breakEven] = await Promise.all([
      this.metrics.calculate('revenue', { tenantId, period }),
      this.metrics.calculate('gross_margin', { tenantId, period }),
      this.metrics.calculate('expense_total', { tenantId, period, withComparison: true }),
      this.metrics.calculate('operating_profit', { tenantId, period }),
      this.metrics.calculate('break_even_revenue', { tenantId, period }),
    ]);
    const byCategory = await this.db.expense.groupBy({
      by: ['category'],
      where: { tenantId, occurredAt: { gte: period.from, lt: period.to } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    });
    return {
      period: periodIso(period),
      revenue: revenue.value,
      grossMargin: margin.value,
      expenses: expenses.value,
      operatingProfit: profit.value,
      breakEvenRevenue: breakEven.value,
      expenseChange: expenses.comparison?.change ?? null,
      byCategory: byCategory.map((row) => ({
        category: row.category,
        amount: Number(row._sum.amount ?? 0),
      })),
    };
  }

  async getCashFlow(tenantId: string, now = new Date()) {
    const horizon = new Date(now.getTime() + 30 * DAY_MS);
    const [open, overdue, dueSoon, received] = await Promise.all([
      this.metrics.calculate('receivables_open', { tenantId, period: { from: new Date(0), to: now } }),
      this.metrics.calculate('overdue_amount', { tenantId, period: { from: new Date(0), to: now } }),
      this.db.payment.aggregate({
        where: { tenantId, status: 'pending', dueAt: { gte: now, lt: horizon } },
        _sum: { amount: true },
      }),
      this.db.payment.aggregate({
        where: { tenantId, status: 'paid', paidAt: { gte: new Date(now.getTime() - 30 * DAY_MS), lt: now } },
        _sum: { amount: true },
      }),
    ]);
    const overdueByCustomer = await this.db.payment.groupBy({
      by: ['saleId'],
      where: { tenantId, status: 'overdue' },
      _sum: { amount: true },
    });
    return {
      received30d: Number(received._sum.amount ?? 0),
      due30d: Number(dueSoon._sum.amount ?? 0),
      open: open.value,
      overdue: overdue.value,
      overdueAccounts: overdueByCustomer.length,
    };
  }

  async getInventoryRisk(tenantId: string, now = new Date()) {
    const latest = await this.db.inventoryLevel.findMany({
      where: { tenantId },
      distinct: ['productId'],
      orderBy: { recordedAt: 'desc' },
      include: { product: { select: { name: true } } },
    });
    const from = new Date(now.getTime() - 30 * DAY_MS);
    const velocity = await this.db.saleItem.groupBy({
      by: ['productId'],
      where: { tenantId, sale: { status: 'confirmed', soldAt: { gte: from, lt: now } } },
      _sum: { quantity: true },
    });
    const vel = new Map(velocity.map((row) => [row.productId, Number(row._sum.quantity ?? 0) / 30]));
    const rows = latest.map((row) => {
      const daily = vel.get(row.productId) ?? 0;
      const qty = Number(row.quantity);
      const cover = daily > 0 ? qty / daily : qty > 0 ? 999 : 0;
      const lastSale = daily > 0 ? 0 : 999;
      return {
        productId: row.productId,
        name: row.product.name,
        quantity: qty,
        minQuantity: row.minQuantity != null ? Number(row.minQuantity) : null,
        coverDays: cover,
        stockoutRisk: daily > 0 && cover < 14,
        deadStock: daily === 0 && lastSale >= 180,
      };
    });
    return {
      stockoutRisk: rows.filter((r) => r.stockoutRisk).sort((a, b) => a.coverDays - b.coverDays).slice(0, 20),
      deadStock: rows.filter((r) => r.deadStock).slice(0, 20),
    };
  }

  async getAcquisition(tenantId: string, period: MetricPeriod) {
    const [campaigns, leads, won] = await Promise.all([
      this.db.campaign.findMany({
        where: {
          tenantId,
          AND: [{ startsAt: { lt: period.to } }, { OR: [{ endsAt: null }, { endsAt: { gte: period.from } }] }],
        },
      }),
      this.db.lead.groupBy({
        by: ['source'],
        where: { tenantId, createdAt: { gte: period.from, lt: period.to } },
        _count: { id: true },
      }),
      this.db.lead.findMany({
        where: { tenantId, status: 'won', updatedAt: { gte: period.from, lt: period.to } },
        select: { source: true, customerId: true },
      }),
    ]);
    const leadsBySource = new Map(leads.map((row) => [row.source ?? 'unknown', row._count.id]));
    const customers = won.map((l) => l.customerId).filter((id): id is string => Boolean(id));
    const sales = customers.length
      ? await this.db.sale.aggregate({
          where: { tenantId, status: 'confirmed', customerId: { in: customers }, soldAt: { gte: period.from, lt: period.to } },
          _sum: { totalAmount: true },
        })
      : { _sum: { totalAmount: null } };
    const bySource = campaigns.map((campaign) => {
      const leadCount = leadsBySource.get(campaign.source) ?? 0;
      const spend = Number(campaign.spend);
      return {
        id: campaign.id,
        name: campaign.name,
        source: campaign.source,
        spend,
        leads: leadCount,
        cac: leadCount > 0 ? spend / leadCount : null,
      };
    });
    return {
      period: periodIso(period),
      campaigns: bySource,
      wonLeads: won.length,
      attributedRevenue: Number(sales._sum.totalAmount ?? 0),
    };
  }

  /** Collect MetricResults used as evidence by analytics tools. */
  async metricEvidence(
    tenantId: string,
    period: MetricPeriod,
    keys: string[],
  ): Promise<MetricResult[]> {
    return Promise.all(
      keys.map((key) =>
        this.metrics.calculate(key as Parameters<MetricEngine['calculate']>[0], {
          tenantId,
          period,
          withComparison: true,
        }),
      ),
    );
  }
}
