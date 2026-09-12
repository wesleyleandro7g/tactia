import { formatInteger, formatMoney, joinNames, plural } from '../format';
import type { DetectedEvent, MetricResult } from '../types';
import { DAY_MS, type Rule, type RuleContext } from './types';

async function averageTicket(ctx: RuleContext): Promise<number> {
  const ticket = await ctx.metrics.calculate('average_ticket', {
    tenantId: ctx.tenantId,
    period: ctx.previousPeriod.from < ctx.period.from
      ? { from: ctx.previousPeriod.from, to: ctx.period.to }
      : ctx.period,
  });
  return ticket.value;
}

export const inactiveLeadsRule: Rule = {
  key: 'inactive_leads',
  async evaluate(ctx) {
    const cutoff = new Date(Date.now() - ctx.thresholds.inactiveLeadDays * DAY_MS);
    const stale = await ctx.db.lead.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { notIn: ['won', 'lost'] },
        activities: { none: { occurredAt: { gte: cutoff } } },
      },
      select: { id: true, name: true, score: true, status: true },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    });
    const count = stale.length;
    if (count === 0) return [];

    const ticket = await averageTicket(ctx);
    const evidence: MetricResult = {
      key: 'inactive_leads_count',
      value: count,
      period: { from: ctx.period.from.toISOString(), to: ctx.period.to.toISOString() },
    };
    const names = stale.slice(0, 3).map((lead) => lead.name);
    const event: DetectedEvent = {
      ruleKey: 'inactive_leads',
      type: 'opportunity',
      severity: count >= 10 ? 'high' : 'medium',
      title: `${count} ${plural(count, 'lead', 'leads')} sem atividade há mais de ${ctx.thresholds.inactiveLeadDays} dias`,
      description:
        `Há ${count} ${plural(count, 'lead ativo', 'leads ativos')} sem nenhuma atividade registrada nos últimos ${ctx.thresholds.inactiveLeadDays} dias` +
        (names.length > 0 ? ` (ex.: ${joinNames(names)})` : '') +
        (ticket > 0
          ? `. Ao ticket médio de ${formatMoney(ticket, ctx.currency)}, são até ${formatMoney(count * ticket, ctx.currency)} em potencial parado.`
          : '.'),
      evidence: [evidence],
      periodFrom: ctx.period.from,
      periodTo: ctx.period.to,
      impactAmount: ticket > 0 ? count * ticket * 0.2 : undefined,
      confidence: 0.6,
    };
    return [event];
  },
};

/** Hot leads (score >= hotLeadScore) that nobody touched recently. */
export const hotLeadStalledRule: Rule = {
  key: 'hot_lead_stalled',
  async evaluate(ctx) {
    const cutoff = new Date(Date.now() - ctx.thresholds.inactiveLeadDays * DAY_MS);
    const hot = await ctx.db.lead.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { notIn: ['won', 'lost'] },
        score: { gte: ctx.thresholds.hotLeadScore },
        activities: { none: { occurredAt: { gte: cutoff } } },
      },
      select: { id: true, name: true, score: true, source: true },
      orderBy: { score: 'desc' },
    });
    if (hot.length === 0) return [];

    const ticket = await averageTicket(ctx);
    const names = hot.slice(0, 3).map((lead) => `${lead.name} (score ${lead.score})`);
    const event: DetectedEvent = {
      ruleKey: 'hot_lead_stalled',
      type: 'opportunity',
      severity: hot.length >= 3 ? 'high' : 'medium',
      title: `${formatInteger(hot.length)} ${plural(hot.length, 'lead quente parado', 'leads quentes parados')}`,
      description:
        `${joinNames(names)} ${plural(hot.length, 'tem', 'têm')} score acima de ${ctx.thresholds.hotLeadScore} e ` +
        `${plural(hot.length, 'está', 'estão')} sem atividade há mais de ${ctx.thresholds.inactiveLeadDays} dias. ` +
        'Leads quentes esfriam rápido: priorize o contato hoje.',
      evidence: [
        {
          key: 'hot_leads_stalled',
          value: hot.length,
          period: { from: ctx.period.from.toISOString(), to: ctx.period.to.toISOString() },
        },
      ],
      periodFrom: ctx.period.from,
      periodTo: ctx.period.to,
      impactAmount: ticket > 0 ? hot.length * ticket * 0.5 : undefined,
      confidence: 0.75,
    };
    return [event];
  },
};
