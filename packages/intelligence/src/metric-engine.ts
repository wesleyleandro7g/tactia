import type { PrismaClient } from '@tactia/database';
import {
  METRIC_DEFINITIONS,
  METRIC_KEYS,
  type MetricBreakdownItem,
  type MetricInput,
  type MetricKey,
  type MetricPeriod,
  type MetricResult,
  type PeriodGranularity,
} from './types';

// Only confirmed sales contribute to revenue/counts (cancelled/refunded excluded)
const CONFIRMED_STATUS = 'confirmed' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 1;
  return (current - previous) / previous;
}

function direction(change: number): 'up' | 'down' | 'flat' {
  if (change > 0.001) return 'up';
  if (change < -0.001) return 'down';
  return 'flat';
}

function previousPeriod(p: MetricPeriod): MetricPeriod {
  const duration = p.to.getTime() - p.from.getTime();
  return {
    from: new Date(p.from.getTime() - duration),
    to: new Date(p.to.getTime() - duration),
  };
}

function periodIso(p: MetricPeriod) {
  return { from: p.from.toISOString(), to: p.to.toISOString() };
}

function decimalToNumber(v: { toNumber(): number } | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return v.toNumber();
}

// ---------------------------------------------------------------------------
// Core aggregate queries
// ---------------------------------------------------------------------------

async function queryRevenue(db: PrismaClient, tenantId: string, period: MetricPeriod): Promise<number> {
  const result = await db.sale.aggregate({
    where: {
      tenantId,
      status: CONFIRMED_STATUS,
      soldAt: { gte: period.from, lt: period.to },
    },
    _sum: { totalAmount: true },
  });
  return decimalToNumber(result._sum.totalAmount);
}

async function querySalesCount(db: PrismaClient, tenantId: string, period: MetricPeriod): Promise<number> {
  return db.sale.count({
    where: {
      tenantId,
      status: CONFIRMED_STATUS,
      soldAt: { gte: period.from, lt: period.to },
    },
  });
}

async function queryComplaintCount(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
): Promise<number> {
  return db.interaction.count({
    where: {
      tenantId,
      intent: 'complaint',
      occurredAt: { gte: period.from, lt: period.to },
    },
  });
}

async function queryCustomerCount(db: PrismaClient, tenantId: string, period: MetricPeriod): Promise<number> {
  const result = await db.sale.groupBy({
    by: ['customerId'],
    where: {
      tenantId,
      status: CONFIRMED_STATUS,
      soldAt: { gte: period.from, lt: period.to },
    },
  });
  return result.length;
}

// ---------------------------------------------------------------------------
// Breakdown queries
// ---------------------------------------------------------------------------

async function breakdownByProduct(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
): Promise<MetricBreakdownItem[]> {
  const rows = await db.saleItem.groupBy({
    by: ['productId'],
    where: {
      tenantId,
      sale: {
        status: CONFIRMED_STATUS,
        soldAt: { gte: period.from, lt: period.to },
      },
    },
    _sum: { totalAmount: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
  });

  const productIds = rows.map((r) => r.productId);
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(products.map((p) => [p.id, p.name]));

  return rows.map((r) => ({
    key: r.productId,
    label: nameMap.get(r.productId),
    value: decimalToNumber(r._sum.totalAmount),
  }));
}

async function breakdownBySeller(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
): Promise<MetricBreakdownItem[]> {
  const rows = await db.sale.groupBy({
    by: ['sellerId'],
    where: {
      tenantId,
      status: CONFIRMED_STATUS,
      soldAt: { gte: period.from, lt: period.to },
      sellerId: { not: null },
    },
    _sum: { totalAmount: true },
    _count: { id: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
  });

  const sellerIds = rows.map((r) => r.sellerId).filter((id): id is string => id != null);
  const sellers = await db.seller.findMany({
    where: { id: { in: sellerIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(sellers.map((s) => [s.id, s.name]));

  return rows.map((r) => ({
    key: r.sellerId ?? 'unknown',
    label: r.sellerId ? nameMap.get(r.sellerId) : undefined,
    value: decimalToNumber(r._sum.totalAmount),
  }));
}

async function breakdownByTime(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
  granularity: PeriodGranularity,
): Promise<MetricBreakdownItem[]> {
  // Use raw SQL via $queryRaw for date_trunc
  const trunc = granularity === 'day' ? 'day' : granularity === 'week' ? 'week' : 'month';

  type BucketRow = { bucket: Date; revenue: string; count: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).$queryRaw<BucketRow[]>`
    SELECT
      date_trunc(${trunc}, s.sold_at) AS bucket,
      COALESCE(SUM(s.total_amount), 0)::text AS revenue,
      COUNT(*)::text AS count
    FROM sales s
    WHERE s.tenant_id = ${tenantId}::uuid
      AND s.status = 'confirmed'
      AND s.sold_at >= ${period.from}
      AND s.sold_at < ${period.to}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  return (rows as BucketRow[]).map((r) => ({
    key: r.bucket.toISOString(),
    value: parseFloat(r.revenue),
  }));
}

// ---------------------------------------------------------------------------
// MetricEngine
// ---------------------------------------------------------------------------

export class MetricEngine {
  constructor(private readonly db: PrismaClient) {}

  /** List available metric definitions (no DB call needed — built-in) */
  listDefinitions() {
    return METRIC_KEYS.map((key) => ({
      key,
      ...METRIC_DEFINITIONS[key],
    }));
  }

  /** Calculate a single metric by key */
  async calculate(key: MetricKey, input: MetricInput): Promise<MetricResult> {
    const { tenantId, period, withComparison = false, breakdown } = input;

    const current = await this.computeScalar(key, tenantId, period);

    let comparison: MetricResult['comparison'];
    if (withComparison) {
      const prev = previousPeriod(period);
      const prevValue = await this.computeScalar(key, tenantId, prev);
      const change = percentChange(current, prevValue);
      comparison = {
        value: prevValue,
        period: periodIso(prev),
        change,
        direction: direction(change),
      };
    }

    let breakdownResult: MetricResult['breakdown'];
    if (breakdown) {
      const items = await this.computeBreakdown(breakdown.dimension, tenantId, period, breakdown.granularity);
      breakdownResult = {
        dimension: breakdown.dimension,
        granularity: breakdown.granularity,
        items,
      };
    }

    return {
      key,
      value: current,
      period: periodIso(period),
      ...(comparison ? { comparison } : {}),
      ...(breakdownResult ? { breakdown: breakdownResult } : {}),
    };
  }

  /** Calculate all 6 metrics at once */
  async calculateAll(input: MetricInput): Promise<MetricResult[]> {
    return Promise.all(METRIC_KEYS.map((key) => this.calculate(key, input)));
  }

  // -------------------------------------------------------------------------

  private async computeScalar(key: MetricKey, tenantId: string, period: MetricPeriod): Promise<number> {
    switch (key) {
      case 'revenue':
        return queryRevenue(this.db, tenantId, period);

      case 'sales_count':
        return querySalesCount(this.db, tenantId, period);

      case 'average_ticket': {
        const [rev, cnt] = await Promise.all([
          queryRevenue(this.db, tenantId, period),
          querySalesCount(this.db, tenantId, period),
        ]);
        return cnt === 0 ? 0 : rev / cnt;
      }

      case 'customer_count':
        return queryCustomerCount(this.db, tenantId, period);

      case 'sales_growth': {
        const current = await querySalesCount(this.db, tenantId, period);
        const prev = await querySalesCount(this.db, tenantId, previousPeriod(period));
        return percentChange(current, prev);
      }

      case 'revenue_growth': {
        const current = await queryRevenue(this.db, tenantId, period);
        const prev = await queryRevenue(this.db, tenantId, previousPeriod(period));
        return percentChange(current, prev);
      }

      case 'complaint_count':
        return queryComplaintCount(this.db, tenantId, period);
    }
  }

  private async computeBreakdown(
    dimension: 'product' | 'seller' | 'time',
    tenantId: string,
    period: MetricPeriod,
    granularity?: PeriodGranularity,
  ): Promise<MetricBreakdownItem[]> {
    switch (dimension) {
      case 'product':
        return breakdownByProduct(this.db, tenantId, period);
      case 'seller':
        return breakdownBySeller(this.db, tenantId, period);
      case 'time':
        return breakdownByTime(this.db, tenantId, period, granularity ?? 'day');
    }
  }
}
