import { formatMoney } from '../format';
import type { Rule } from './types';

export const retentionDropRule: Rule = {
  key: 'retention_drop',
  async evaluate(ctx) {
    const customers = await ctx.db.sale.groupBy({
      by: ['customerId'],
      where: { tenantId: ctx.tenantId, status: 'confirmed', soldAt: { gte: ctx.previousPeriod.from, lt: ctx.previousPeriod.to } },
      _count: { id: true },
    });
    if (customers.length < 8) return [];
    const ids = customers.map((c) => c.customerId);
    const returned = await ctx.db.sale.groupBy({
      by: ['customerId'],
      where: {
        tenantId: ctx.tenantId,
        status: 'confirmed',
        customerId: { in: ids },
        soldAt: { gte: ctx.period.from, lt: ctx.period.to },
      },
      _count: { id: true },
    });
    const rate = returned.length / customers.length;
    if (rate >= 0.35) return [];
    return [
      {
        ruleKey: 'retention_drop',
        type: 'warning',
        severity: 'high',
        title: `Retenção de ${Math.round(rate * 100)}% entre períodos`,
        description: `Só ${returned.length} de ${customers.length} clientes do período anterior voltaram a comprar.`,
        evidence: [],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        impactAmount: customers.length - returned.length,
        confidence: 0.7,
      },
    ];
  },
};

export const championsAtRiskRule: Rule = {
  key: 'champions_at_risk',
  async evaluate(ctx) {
    const sales = await ctx.db.sale.groupBy({
      by: ['customerId'],
      where: { tenantId: ctx.tenantId, status: 'confirmed' },
      _sum: { totalAmount: true },
      _max: { soldAt: true },
      _count: { id: true },
    });
    const champs = sales
      .filter((row) => row._count.id >= 3)
      .sort((a, b) => Number(b._sum.totalAmount ?? 0) - Number(a._sum.totalAmount ?? 0))
      .slice(0, 10)
      .filter((row) => {
        const last = row._max.soldAt;
        if (!last) return false;
        return ctx.period.to.getTime() - last.getTime() > 45 * 24 * 60 * 60 * 1000;
      });
    if (champs.length === 0) return [];
    const names = await ctx.db.customer.findMany({
      where: { id: { in: champs.map((c) => c.customerId) } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(names.map((n) => [n.id, n.name]));
    return champs.slice(0, 3).map((row) => ({
      ruleKey: 'champions_at_risk',
      type: 'warning' as const,
      severity: 'high' as const,
      title: `${nameMap.get(row.customerId) ?? 'Cliente'} (campeão) sem compra recente`,
      description: `Já comprou ${row._count.id} vezes (${formatMoney(Number(row._sum.totalAmount ?? 0), ctx.currency)}) e está há mais de 45 dias sem nova venda.`,
      evidence: [],
      periodFrom: ctx.period.from,
      periodTo: ctx.period.to,
      entityType: 'customer',
      entityId: row.customerId,
      entityLabel: nameMap.get(row.customerId),
      impactAmount: Number(row._sum.totalAmount ?? 0),
      confidence: 0.8,
    }));
  },
};
