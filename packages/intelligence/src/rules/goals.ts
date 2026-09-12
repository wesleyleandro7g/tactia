import { formatMoney, formatPercent } from '../format';
import type { Rule } from './types';

export const goalPaceBehindRule: Rule = {
  key: 'goal_pace_behind',
  async evaluate(ctx) {
    const goals = await ctx.db.goal.findMany({ where: { tenantId: ctx.tenantId } });
    const events = [];
    for (const goal of goals) {
      if (goal.metricKey !== 'revenue') continue;
      const result = await ctx.metrics.calculate('revenue', { tenantId: ctx.tenantId, period: ctx.period });
      const target = Number(goal.target);
      if (target <= 0) continue;
      const elapsed = Math.min(
        1,
        Math.max(0, (ctx.period.to.getTime() - goal.periodStart.getTime()) / Math.max(1, ctx.period.to.getTime() - goal.periodStart.getTime())),
      );
      const required = target * elapsed;
      if (result.value >= required * (1 - ctx.thresholds.goalPaceTolerance)) continue;
      const gap = required - result.value;
      events.push({
        ruleKey: 'goal_pace_behind',
        type: 'warning' as const,
        severity: gap / target > 0.25 ? 'high' as const : 'medium' as const,
        title: `Meta de receita ${formatPercent(1 - result.value / target)} atrás do ritmo`,
        description: `Realizado ${formatMoney(result.value, ctx.currency)} contra ${formatMoney(required, ctx.currency)} esperados neste ponto da meta de ${formatMoney(target, ctx.currency)}.`,
        evidence: [result],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'goal',
        entityId: goal.id,
        impactAmount: gap,
        confidence: 0.85,
      });
    }
    return events;
  },
};

export const goalReachedRule: Rule = {
  key: 'goal_reached',
  async evaluate(ctx) {
    const goals = await ctx.db.goal.findMany({ where: { tenantId: ctx.tenantId } });
    const events = [];
    for (const goal of goals) {
      if (goal.metricKey !== 'revenue') continue;
      const result = await ctx.metrics.calculate('revenue', { tenantId: ctx.tenantId, period: ctx.period });
      const target = Number(goal.target);
      if (target <= 0 || result.value < target) continue;
      events.push({
        ruleKey: 'goal_reached',
        type: 'performance' as const,
        severity: 'low' as const,
        title: 'Meta de receita atingida',
        description: `${formatMoney(result.value, ctx.currency)} já superam a meta de ${formatMoney(target, ctx.currency)}.`,
        evidence: [result],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'goal',
        entityId: goal.id,
        impactAmount: result.value - target,
        confidence: 0.95,
      });
    }
    return events;
  },
};
