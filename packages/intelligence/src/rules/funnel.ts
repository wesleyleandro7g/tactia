import type { Rule } from './types';

export const funnelBottleneckRule: Rule = {
  key: 'funnel_bottleneck',
  async evaluate(ctx) {
    const counts = await ctx.db.lead.groupBy({
      by: ['status'],
      where: { tenantId: ctx.tenantId, status: { notIn: ['won', 'lost'] } },
      _count: { id: true },
    });
    if (counts.length === 0) return [];
    const total = counts.reduce((s, r) => s + r._count.id, 0);
    const top = [...counts].sort((a, b) => b._count.id - a._count.id)[0]!;
    if (total < 8 || top._count.id / total < 0.45) return [];
    return [
      {
        ruleKey: 'funnel_bottleneck',
        type: 'warning',
        severity: 'medium',
        title: `Gargalo no funil: ${top.status}`,
        description: `${top._count.id} de ${total} leads abertos estão em ${top.status}. Vale revisar o próximo passo desse estágio.`,
        evidence: [],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        impactAmount: top._count.id,
        confidence: 0.7,
      },
    ];
  },
};

export const leadVelocityDropRule: Rule = {
  key: 'lead_velocity_drop',
  async evaluate(ctx) {
    const current = await ctx.db.lead.count({
      where: { tenantId: ctx.tenantId, createdAt: { gte: ctx.period.from, lt: ctx.period.to } },
    });
    const previous = await ctx.db.lead.count({
      where: { tenantId: ctx.tenantId, createdAt: { gte: ctx.previousPeriod.from, lt: ctx.previousPeriod.to } },
    });
    if (previous < 5) return [];
    const change = (current - previous) / previous;
    if (change > -0.3) return [];
    return [
      {
        ruleKey: 'lead_velocity_drop',
        type: 'anomaly',
        severity: 'medium',
        title: `Entrada de leads caiu ${Math.round(Math.abs(change) * 100)}%`,
        description: `${current} leads novos neste período contra ${previous} no anterior.`,
        evidence: [],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        impactAmount: previous - current,
        confidence: 0.75,
      },
    ];
  },
};
