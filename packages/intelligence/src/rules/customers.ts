import { Prisma } from '@tactia/database';
import { formatInteger, formatMoney, joinNames, plural } from '../format';
import type { DetectedEvent, Drivers, MetricResult } from '../types';
import { DAY_MS, type Rule, type RuleContext } from './types';

export type ChurnRiskCustomer = {
  customerId: string;
  name: string;
  salesCount: number;
  lifetimeRevenue: number;
  avgTicket: number;
  avgIntervalDays: number;
  daysSinceLastPurchase: number;
  lastPurchaseAt: Date;
  /** Expected revenue over the next cycle if the customer kept buying. */
  expectedNextValue: number;
};

type Row = {
  customer_id: string;
  name: string;
  sales_count: string;
  revenue: string;
  first_purchase: Date;
  last_purchase: Date;
};

/**
 * Customers whose silence is abnormal *for them*: days since the last purchase
 * exceed `churnIntervalFactor` × their own average purchase interval. Requires
 * at least 3 purchases so the cadence is meaningful; ignores customers silent
 * for more than 4 cycles (already lost — a different problem).
 */
export async function findChurnRiskCustomers(
  ctx: Pick<RuleContext, 'db' | 'tenantId' | 'thresholds'>,
  now = new Date(),
): Promise<ChurnRiskCustomer[]> {
  const rows = await ctx.db.$queryRaw<Row[]>(Prisma.sql`
    SELECT c.id AS customer_id, c.name,
           COUNT(s.id)::text AS sales_count,
           COALESCE(SUM(s.total_amount), 0)::text AS revenue,
           MIN(s.sold_at) AS first_purchase,
           MAX(s.sold_at) AS last_purchase
    FROM customers c
    INNER JOIN sales s ON s.customer_id = c.id AND s.status = 'confirmed' AND s.tenant_id = ${ctx.tenantId}::uuid
    WHERE c.tenant_id = ${ctx.tenantId}::uuid
      AND c.deleted_at IS NULL
      AND c.status = 'active'
    GROUP BY c.id, c.name
    HAVING COUNT(s.id) >= 3
  `);

  const result: ChurnRiskCustomer[] = [];
  for (const row of rows) {
    const salesCount = parseInt(row.sales_count, 10);
    const revenue = parseFloat(row.revenue);
    const spanDays = (row.last_purchase.getTime() - row.first_purchase.getTime()) / DAY_MS;
    const avgInterval = spanDays / (salesCount - 1);
    if (avgInterval < 1) continue; // several purchases on the same day: no cadence
    const daysSince = (now.getTime() - row.last_purchase.getTime()) / DAY_MS;
    const factor = daysSince / avgInterval;
    if (factor < ctx.thresholds.churnIntervalFactor || factor > 4) continue;
    const avgTicket = revenue / salesCount;
    result.push({
      customerId: row.customer_id,
      name: row.name,
      salesCount,
      lifetimeRevenue: revenue,
      avgTicket,
      avgIntervalDays: Math.round(avgInterval),
      daysSinceLastPurchase: Math.floor(daysSince),
      lastPurchaseAt: row.last_purchase,
      expectedNextValue: avgTicket,
    });
  }
  return result.sort((a, b) => b.expectedNextValue - a.expectedNextValue);
}

function churnDrivers(ctx: RuleContext, customers: ChurnRiskCustomer[]): Drivers {
  const total = customers.reduce((sum, c) => sum + c.expectedNextValue, 0);
  return {
    metric: 'expected_revenue_at_risk',
    period: { from: ctx.period.from.toISOString(), to: ctx.period.to.toISOString() },
    comparisonPeriod: { from: ctx.period.from.toISOString(), to: ctx.period.to.toISOString() },
    current: 0,
    previous: total,
    delta: -total,
    change: -1,
    byDimension: [
      {
        dimension: 'customer',
        explainedShare: 1,
        contributors: customers.slice(0, 10).map((c) => ({
          key: c.customerId,
          label: c.name,
          current: 0,
          previous: c.expectedNextValue,
          delta: -c.expectedNextValue,
          share: total === 0 ? 0 : c.expectedNextValue / total,
          status: 'lost' as const,
        })),
      },
    ],
    summary: `${customers.length} ${plural(customers.length, 'cliente', 'clientes')} com ${formatMoney(total, ctx.currency)} de receita esperada em risco.`,
  };
}

export const customerChurnRiskRule: Rule = {
  key: 'customer_churn_risk',
  async evaluate(ctx) {
    const customers = (await findChurnRiskCustomers(ctx)).filter(
      (c) => !ctx.isSuppressed('customer', c.customerId),
    );
    if (customers.length === 0) return [];

    const atRisk = customers.reduce((sum, c) => sum + c.expectedNextValue, 0);
    const top = customers.slice(0, 3);
    const evidence: MetricResult = {
      key: 'churn_risk_customers',
      value: customers.length,
      period: { from: ctx.period.from.toISOString(), to: ctx.period.to.toISOString() },
    };
    const event: DetectedEvent = {
      ruleKey: 'customer_churn_risk',
      type: 'opportunity',
      severity: customers.length >= 10 || atRisk >= 10000 ? 'high' : 'medium',
      title: `${formatInteger(customers.length)} ${plural(customers.length, 'cliente', 'clientes')} em risco de churn`,
      description:
        `${formatInteger(customers.length)} ${plural(customers.length, 'cliente recorrente está', 'clientes recorrentes estão')} sem comprar ` +
        `há mais tempo que o normal para ${plural(customers.length, 'ele', 'eles')} (acima de ${ctx.thresholds.churnIntervalFactor}× o intervalo habitual). ` +
        `Receita esperada em risco: ${formatMoney(atRisk, ctx.currency)}. Prioridade: ${joinNames(
          top.map(
            (c) =>
              `${c.name} (compra a cada ~${c.avgIntervalDays} dias, parado há ${c.daysSinceLastPurchase}; ticket ${formatMoney(c.avgTicket, ctx.currency)})`,
          ),
        )}.`,
      evidence: [evidence],
      periodFrom: ctx.period.from,
      periodTo: ctx.period.to,
      impactAmount: atRisk,
      confidence: 0.7,
      drivers: churnDrivers(ctx, customers),
    };
    return [event];
  },
};

/** Cross-signal: a customer in churn risk who also complained recently. */
export const churnRiskWithComplaintRule: Rule = {
  key: 'churn_risk_with_open_complaint',
  async evaluate(ctx) {
    const customers = await findChurnRiskCustomers(ctx);
    if (customers.length === 0) return [];

    const since = new Date(Date.now() - 60 * DAY_MS);
    const complaints = await ctx.db.interaction.groupBy({
      by: ['customerId'],
      where: {
        tenantId: ctx.tenantId,
        intent: 'complaint',
        occurredAt: { gte: since },
        customerId: { in: customers.map((c) => c.customerId) },
      },
      _count: { id: true },
    });
    const complaintMap = new Map(
      complaints.filter((c) => c.customerId).map((c) => [c.customerId as string, c._count.id]),
    );

    const events: DetectedEvent[] = [];
    for (const customer of customers) {
      const count = complaintMap.get(customer.customerId);
      if (!count || ctx.isSuppressed('customer', customer.customerId)) continue;
      events.push({
        ruleKey: 'churn_risk_with_open_complaint',
        type: 'warning',
        severity: 'high',
        title: `${customer.name}: reclamou e parou de comprar`,
        description:
          `${customer.name} registrou ${count} ${plural(count, 'reclamação', 'reclamações')} nos últimos 60 dias e está há ` +
          `${customer.daysSinceLastPurchase} dias sem comprar (costuma comprar a cada ~${customer.avgIntervalDays} dias). ` +
          `Receita histórica: ${formatMoney(customer.lifetimeRevenue, ctx.currency)}. Um contato direto agora tem alta chance de reter o cliente.`,
        evidence: [
          {
            key: 'complaint_count',
            value: count,
            period: { from: since.toISOString(), to: new Date().toISOString() },
          },
        ],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'customer',
        entityId: customer.customerId,
        entityLabel: customer.name,
        impactAmount: customer.avgTicket * 3,
        confidence: 0.85,
      });
    }
    return events;
  },
};
