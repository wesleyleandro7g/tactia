import type { PrismaClient } from '@tactia/database';
import {
  METRIC_DEFINITIONS,
  METRIC_KEYS,
  type MetricBreakdownItem,
  type MetricDimension,
  type MetricInput,
  type MetricKey,
  type MetricPeriod,
  type MetricResult,
  type PeriodGranularity,
  periodIso,
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

async function queryDiscountTotal(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
): Promise<number> {
  const result = await db.sale.aggregate({
    where: {
      tenantId,
      status: CONFIRMED_STATUS,
      soldAt: { gte: period.from, lt: period.to },
    },
    _sum: { discountAmount: true },
  });
  return decimalToNumber(result._sum.discountAmount);
}

async function queryGrossMargin(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
): Promise<number> {
  type MarginRow = { revenue: string; cost: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).$queryRaw<MarginRow[]>`
    SELECT
      COALESCE(SUM(si.total_amount), 0)::text AS revenue,
      COALESCE(SUM(si.quantity * COALESCE(p.cost, 0)), 0)::text AS cost
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.sale_id
    INNER JOIN products p ON p.id = si.product_id
    WHERE si.tenant_id = ${tenantId}::uuid
      AND s.status = 'confirmed'
      AND s.sold_at >= ${period.from}
      AND s.sold_at < ${period.to}
      AND p.cost IS NOT NULL
  `;
  const row = rows[0];
  if (!row) return 0;
  return parseFloat(row.revenue) - parseFloat(row.cost);
}

async function queryUnitsSold(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
): Promise<number> {
  const result = await db.saleItem.aggregate({
    where: {
      tenantId,
      sale: {
        status: CONFIRMED_STATUS,
        soldAt: { gte: period.from, lt: period.to },
      },
    },
    _sum: { quantity: true },
  });
  return decimalToNumber(result._sum.quantity);
}

async function queryClosedRate(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
  status: 'cancelled' | 'refunded',
): Promise<number> {
  const closedStatuses = ['confirmed', 'cancelled', 'refunded'] as const;
  const where = {
    tenantId,
    soldAt: { gte: period.from, lt: period.to },
    status: { in: [...closedStatuses] },
  };
  const [closed, matching] = await Promise.all([
    db.sale.count({ where }),
    db.sale.count({ where: { ...where, status } }),
  ]);
  return closed === 0 ? 0 : matching / closed;
}

async function queryPendingAmount(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
): Promise<number> {
  const result = await db.sale.aggregate({
    where: {
      tenantId,
      status: 'pending',
      soldAt: { gte: period.from, lt: period.to },
    },
    _sum: { totalAmount: true },
  });
  return decimalToNumber(result._sum.totalAmount);
}

async function queryExpenseTotal(db: PrismaClient, tenantId: string, period: MetricPeriod): Promise<number> {
  const result = await db.expense.aggregate({
    where: { tenantId, occurredAt: { gte: period.from, lt: period.to } },
    _sum: { amount: true },
  });
  return decimalToNumber(result._sum.amount);
}

async function queryReceivables(
  db: PrismaClient,
  tenantId: string,
  statuses: Array<'pending' | 'overdue'>,
): Promise<number> {
  const result = await db.payment.aggregate({
    where: { tenantId, status: { in: statuses } },
    _sum: { amount: true },
  });
  return decimalToNumber(result._sum.amount);
}

async function queryDso(db: PrismaClient, tenantId: string, period: MetricPeriod): Promise<number> {
  const paid = await db.payment.findMany({
    where: {
      tenantId,
      status: 'paid',
      paidAt: { gte: period.from, lt: period.to },
    },
    select: { paidAt: true, sale: { select: { soldAt: true } } },
    take: 2000,
  });
  if (paid.length === 0) return 0;
  const days = paid
    .filter((row) => row.paidAt)
    .map((row) => (row.paidAt!.getTime() - row.sale.soldAt.getTime()) / (24 * 60 * 60 * 1000));
  if (days.length === 0) return 0;
  return days.reduce((s, d) => s + d, 0) / days.length;
}

async function breakdownBySaleField(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
  field: 'channel' | 'region',
): Promise<MetricBreakdownItem[]> {
  const rows = await db.sale.groupBy({
    by: [field],
    where: {
      tenantId,
      status: CONFIRMED_STATUS,
      soldAt: { gte: period.from, lt: period.to },
    },
    _sum: { totalAmount: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
  });
  return rows.map((row) => ({
    key: (row[field] as string | null) ?? 'unknown',
    label: (row[field] as string | null) ?? 'Sem classificação',
    value: decimalToNumber(row._sum.totalAmount),
  }));
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

/** Customers whose first confirmed sale happened inside the period. */
async function queryNewCustomers(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count
    FROM (
      SELECT customer_id, MIN(sold_at) AS first_sale
      FROM sales
      WHERE tenant_id = ${tenantId}::uuid AND status = 'confirmed'
      GROUP BY customer_id
    ) firsts
    WHERE firsts.first_sale >= ${period.from} AND firsts.first_sale < ${period.to}
  `;
  return parseInt(rows[0]?.count ?? '0', 10);
}

async function breakdownByCustomer(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
): Promise<MetricBreakdownItem[]> {
  const rows = await db.sale.groupBy({
    by: ['customerId'],
    where: {
      tenantId,
      status: CONFIRMED_STATUS,
      soldAt: { gte: period.from, lt: period.to },
    },
    _sum: { totalAmount: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
  });

  const customerIds = rows.map((r) => r.customerId);
  const customers = await db.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(customers.map((c) => [c.id, c.name]));

  return rows.map((r) => ({
    key: r.customerId,
    label: nameMap.get(r.customerId),
    value: decimalToNumber(r._sum.totalAmount),
  }));
}

async function breakdownByTime(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
  granularity: PeriodGranularity,
  metricKey?: MetricKey,
): Promise<MetricBreakdownItem[]> {
  // Use raw SQL via $queryRaw for date_trunc
  const trunc = granularity === 'day' ? 'day' : granularity === 'week' ? 'week' : 'month';
  const useCount = metricKey === 'sales_count';

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
    value: useCount ? parseInt(r.count, 10) : parseFloat(r.revenue),
  }));
}

async function breakdownByCategory(
  db: PrismaClient,
  tenantId: string,
  period: MetricPeriod,
): Promise<MetricBreakdownItem[]> {
  type CategoryRow = { category: string | null; revenue: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).$queryRaw<CategoryRow[]>`
    SELECT
      COALESCE(p.category, 'Sem categoria') AS category,
      COALESCE(SUM(si.total_amount), 0)::text AS revenue
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.sale_id
    INNER JOIN products p ON p.id = si.product_id
    WHERE si.tenant_id = ${tenantId}::uuid
      AND s.status = 'confirmed'
      AND s.sold_at >= ${period.from}
      AND s.sold_at < ${period.to}
    GROUP BY p.category
    ORDER BY revenue DESC
  `;
  return (rows as CategoryRow[]).map((row) => ({
    key: row.category ?? 'Sem categoria',
    label: row.category ?? 'Sem categoria',
    value: parseFloat(row.revenue),
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
    const { tenantId, period, withComparison = false, compareWith, breakdown } = input;

    const current = await this.computeScalar(key, tenantId, period);

    let comparison: MetricResult['comparison'];
    if (withComparison || compareWith) {
      const prev = compareWith ?? previousPeriod(period);
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
      const items = await this.computeBreakdown(
        breakdown.dimension,
        tenantId,
        period,
        breakdown.granularity,
        key,
      );
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

  /** Calculate all built-in metrics at once */
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

      case 'discount_total':
        return queryDiscountTotal(this.db, tenantId, period);

      case 'gross_margin':
        return queryGrossMargin(this.db, tenantId, period);

      case 'units_sold':
        return queryUnitsSold(this.db, tenantId, period);

      case 'cancellation_rate':
        return queryClosedRate(this.db, tenantId, period, 'cancelled');

      case 'refund_rate':
        return queryClosedRate(this.db, tenantId, period, 'refunded');

      case 'pending_amount':
        return queryPendingAmount(this.db, tenantId, period);

      case 'new_customers':
        return queryNewCustomers(this.db, tenantId, period);

      case 'expense_total':
        return queryExpenseTotal(this.db, tenantId, period);

      case 'operating_profit': {
        const [marginReais, expenses] = await Promise.all([
          queryGrossMargin(this.db, tenantId, period),
          queryExpenseTotal(this.db, tenantId, period),
        ]);
        return marginReais - expenses;
      }

      case 'break_even_revenue': {
        const [marginReais, expenses, revenue] = await Promise.all([
          queryGrossMargin(this.db, tenantId, period),
          queryExpenseTotal(this.db, tenantId, period),
          queryRevenue(this.db, tenantId, period),
        ]);
        const rate = revenue > 0 ? marginReais / revenue : 0;
        if (rate <= 0) return 0;
        return expenses / rate;
      }

      case 'receivables_open':
        return queryReceivables(this.db, tenantId, ['pending', 'overdue']);

      case 'overdue_amount':
        return queryReceivables(this.db, tenantId, ['overdue']);

      case 'dso':
        return queryDso(this.db, tenantId, period);
    }
  }

  private async computeBreakdown(
    dimension: MetricDimension,
    tenantId: string,
    period: MetricPeriod,
    granularity?: PeriodGranularity,
    metricKey?: MetricKey,
  ): Promise<MetricBreakdownItem[]> {
    switch (dimension) {
      case 'product':
        return breakdownByProduct(this.db, tenantId, period);
      case 'seller':
        return breakdownBySeller(this.db, tenantId, period);
      case 'time':
        return breakdownByTime(this.db, tenantId, period, granularity ?? 'day', metricKey);
      case 'category':
        return breakdownByCategory(this.db, tenantId, period);
      case 'customer':
        return breakdownByCustomer(this.db, tenantId, period);
      case 'channel':
        return breakdownBySaleField(this.db, tenantId, period, 'channel');
      case 'region':
        return breakdownBySaleField(this.db, tenantId, period, 'region');
    }
  }
}
