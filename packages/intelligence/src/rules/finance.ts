import { formatMoney, formatPercent } from '../format';
import type { Rule } from './types';

export const expenseSpikeRule: Rule = {
  key: 'expense_spike',
  async evaluate(ctx) {
    const current = await ctx.metrics.calculate('expense_total', {
      tenantId: ctx.tenantId,
      period: ctx.period,
      withComparison: true,
    });
    const prev = current.comparison?.value ?? 0;
    if (prev <= 0 || (current.comparison?.change ?? 0) < ctx.thresholds.expenseSpike) return [];
    return [
      {
        ruleKey: 'expense_spike',
        type: 'anomaly',
        severity: 'medium',
        title: `Despesas subiram ${formatPercent(current.comparison?.change ?? 0)}`,
        description: `${formatMoney(current.value, ctx.currency)} neste período contra ${formatMoney(prev, ctx.currency)} no anterior.`,
        evidence: [current],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        impactAmount: current.value - prev,
        confidence: 0.8,
      },
    ];
  },
};

export const negativeOperatingProfitRule: Rule = {
  key: 'negative_operating_profit',
  async evaluate(ctx) {
    const profit = await ctx.metrics.calculate('operating_profit', { tenantId: ctx.tenantId, period: ctx.period });
    if (profit.value >= 0) return [];
    return [
      {
        ruleKey: 'negative_operating_profit',
        type: 'anomaly',
        severity: 'critical',
        title: 'Lucro operacional negativo',
        description: `A operação fechou o período em ${formatMoney(profit.value, ctx.currency)} depois das despesas.`,
        evidence: [profit],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        impactAmount: Math.abs(profit.value),
        confidence: 0.85,
      },
    ];
  },
};

export const overdueSpikeRule: Rule = {
  key: 'overdue_spike',
  async evaluate(ctx) {
    const [overdue, open] = await Promise.all([
      ctx.metrics.calculate('overdue_amount', { tenantId: ctx.tenantId, period: ctx.period }),
      ctx.metrics.calculate('receivables_open', { tenantId: ctx.tenantId, period: ctx.period }),
    ]);
    if (open.value <= 0 || overdue.value / open.value < ctx.thresholds.overdueShare) return [];
    return [
      {
        ruleKey: 'overdue_spike',
        type: 'warning',
        severity: 'high',
        title: `${formatPercent(overdue.value / open.value)} do a receber está vencido`,
        description: `${formatMoney(overdue.value, ctx.currency)} vencidos de ${formatMoney(open.value, ctx.currency)} em aberto.`,
        evidence: [overdue, open],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        impactAmount: overdue.value,
        confidence: 0.85,
      },
    ];
  },
};

export const customerOverdueWithNewSaleRule: Rule = {
  key: 'customer_overdue_with_new_sale',
  async evaluate(ctx) {
    const overdue = await ctx.db.payment.findMany({
      where: { tenantId: ctx.tenantId, status: 'overdue' },
      select: { amount: true, sale: { select: { customerId: true, customer: { select: { name: true } } } } },
      take: 100,
    });
    const byCustomer = new Map<string, { name: string; amount: number }>();
    for (const row of overdue) {
      const id = row.sale.customerId;
      const current = byCustomer.get(id) ?? { name: row.sale.customer.name, amount: 0 };
      current.amount += Number(row.amount);
      byCustomer.set(id, current);
    }
    const events = [];
    for (const [customerId, info] of byCustomer) {
      const recent = await ctx.db.sale.count({
        where: {
          tenantId: ctx.tenantId,
          customerId,
          status: 'confirmed',
          soldAt: { gte: ctx.period.from, lt: ctx.period.to },
        },
      });
      if (recent === 0) continue;
      events.push({
        ruleKey: 'customer_overdue_with_new_sale',
        type: 'warning' as const,
        severity: 'high' as const,
        title: `${info.name}: nova venda com título vencido`,
        description: `Há ${formatMoney(info.amount, ctx.currency)} vencidos e ${recent} venda(s) nova(s) no período.`,
        evidence: [],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'customer',
        entityId: customerId,
        entityLabel: info.name,
        impactAmount: info.amount,
        confidence: 0.8,
      });
    }
    return events.slice(0, 5);
  },
};
