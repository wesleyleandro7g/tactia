import { formatMoney } from '../format';
import type { Rule } from './types';

export const cacSpikeRule: Rule = {
  key: 'cac_spike',
  async evaluate(ctx) {
    const campaigns = await ctx.db.campaign.findMany({ where: { tenantId: ctx.tenantId } });
    if (campaigns.length === 0) return [];
    const events = [];
    for (const campaign of campaigns) {
      const leads = await ctx.db.lead.count({
        where: {
          tenantId: ctx.tenantId,
          source: campaign.source,
          createdAt: { gte: ctx.period.from, lt: ctx.period.to },
        },
      });
      const prev = await ctx.db.lead.count({
        where: {
          tenantId: ctx.tenantId,
          source: campaign.source,
          createdAt: { gte: ctx.previousPeriod.from, lt: ctx.previousPeriod.to },
        },
      });
      const spend = Number(campaign.spend);
      const cac = leads > 0 ? spend / leads : null;
      const prevCac = prev > 0 ? spend / prev : null;
      if (cac == null || prevCac == null || prevCac === 0) continue;
      const change = (cac - prevCac) / prevCac;
      if (change < ctx.thresholds.cacSpike) continue;
      events.push({
        ruleKey: 'cac_spike',
        type: 'warning' as const,
        severity: 'medium' as const,
        title: `CAC de ${campaign.source} subiu`,
        description: `Custo por lead foi de ${formatMoney(prevCac, ctx.currency)} para ${formatMoney(cac, ctx.currency)} (${campaign.name}).`,
        evidence: [],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'campaign',
        entityId: campaign.id,
        entityLabel: campaign.name,
        impactAmount: cac - prevCac,
        confidence: 0.65,
      });
    }
    return events;
  },
};

export const campaignWithoutLeadsRule: Rule = {
  key: 'campaign_without_leads',
  async evaluate(ctx) {
    const campaigns = await ctx.db.campaign.findMany({
      where: {
        tenantId: ctx.tenantId,
        startsAt: { lt: ctx.period.to },
        OR: [{ endsAt: null }, { endsAt: { gte: ctx.period.from } }],
      },
    });
    const events = [];
    for (const campaign of campaigns) {
      const leads = await ctx.db.lead.count({
        where: {
          tenantId: ctx.tenantId,
          source: campaign.source,
          createdAt: { gte: ctx.period.from, lt: ctx.period.to },
        },
      });
      if (leads > 0) continue;
      events.push({
        ruleKey: 'campaign_without_leads',
        type: 'warning' as const,
        severity: 'medium' as const,
        title: `${campaign.name} sem leads no período`,
        description: `A campanha de ${campaign.source} gastou ${formatMoney(Number(campaign.spend), ctx.currency)} e não gerou leads neste intervalo.`,
        evidence: [],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'campaign',
        entityId: campaign.id,
        entityLabel: campaign.name,
        impactAmount: Number(campaign.spend),
        confidence: 0.75,
      });
    }
    return events;
  },
};
