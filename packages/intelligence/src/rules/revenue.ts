import { describeBaseline, type BaselineStats } from '../baseline';
import { formatMoney, formatPercent } from '../format';
import { confidenceFromSample } from '../scoring';
import type { DetectedEvent, MetricResult } from '../types';
import type { Rule, RuleContext } from './types';

async function revenueWithCounts(ctx: RuleContext) {
  const [growth, revenue, salesCount, prevSalesCount, baseline] = await Promise.all([
    ctx.metrics.calculate('revenue_growth', { tenantId: ctx.tenantId, period: ctx.period }),
    ctx.metrics.calculate('revenue', {
      tenantId: ctx.tenantId,
      period: ctx.period,
      withComparison: true,
    }),
    ctx.metrics.calculate('sales_count', { tenantId: ctx.tenantId, period: ctx.period }),
    ctx.metrics.calculate('sales_count', { tenantId: ctx.tenantId, period: ctx.previousPeriod }),
    ctx.baselineFor({ metric: 'revenue' }),
  ]);
  return { growth, revenue, sampleSize: salesCount.value + prevSalesCount.value, baseline };
}

/** Evidence item carrying the baseline so the UI/chat can cite the reference. */
export function baselineEvidence(stats: BaselineStats): MetricResult {
  return {
    key: `${stats.metric}_baseline`,
    value: stats.expected,
    period: stats.period,
    comparison: {
      value: stats.current,
      period: stats.period,
      change: stats.deviation,
      direction: stats.deviation > 0.001 ? 'up' : stats.deviation < -0.001 ? 'down' : 'flat',
    },
    metadata: {
      zScore: stats.zScore,
      movingAvg7: stats.movingAvg7,
      movingAvg28: stats.movingAvg28,
      referenceLabel: stats.referenceLabel,
      yoy: stats.yoy,
      historyDays: stats.historyDays,
    },
  };
}

/** Confidence grows with sample size and with a statistically clear signal. */
function confidenceWithBaseline(sampleSize: number, baseline: BaselineStats | null): number {
  const base = confidenceFromSample(sampleSize);
  if (!baseline || baseline.zScore === null) return base;
  const boost = Math.min(0.15, Math.abs(baseline.zScore) * 0.05);
  return Math.min(0.98, base + boost);
}

function baselineSentence(ctx: RuleContext, baseline: BaselineStats | null): string {
  if (!baseline) return '';
  return ` Referência: ${describeBaseline(baseline, (v) => formatMoney(v, ctx.currency))}.`;
}

/**
 * Revenue fell more than `thresholds.revenueDrop` vs. the previous period
 * **or** sits ≥ `anomalyZScore` standard deviations below the baseline built
 * from daily snapshots. `revenue_growth` already IS the variation — never
 * compare it with itself.
 */
export const revenueDropRule: Rule = {
  key: 'revenue_drop',
  async evaluate(ctx) {
    const { growth, revenue, sampleSize, baseline } = await revenueWithCounts(ctx);
    const change = growth.value;
    const previous = revenue.comparison?.value ?? 0;

    const thresholdHit = previous > 0 && change <= ctx.thresholds.revenueDrop;
    const baselineHit =
      baseline !== null &&
      baseline.isAnomaly &&
      baseline.direction === 'below' &&
      baseline.expected > 0;
    if (!thresholdHit && !baselineHit) return [];

    const drivers = await ctx.decompose({ metric: 'revenue', period: ctx.period });
    const pct = Math.round(Math.abs(thresholdHit ? change : baseline!.deviation) * 100);
    const impact = thresholdHit ? Math.abs(drivers.delta) : Math.abs(baseline!.delta);
    const severe = thresholdHit ? change <= -0.3 : (baseline!.zScore ?? 0) <= -3;

    return [
      {
        ruleKey: 'revenue_drop',
        type: 'anomaly',
        severity: severe ? 'critical' : 'high',
        title: thresholdHit
          ? `Queda de receita de ${pct}%`
          : `Receita ${pct}% abaixo do esperado`,
        description: drivers.summary + baselineSentence(ctx, baseline),
        evidence: baseline ? [growth, revenue, baselineEvidence(baseline)] : [growth, revenue],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        impactAmount: impact,
        confidence: confidenceWithBaseline(sampleSize, baseline),
        drivers,
      },
    ];
  },
};

export const revenueGrowthRule: Rule = {
  key: 'revenue_growth',
  async evaluate(ctx) {
    const { growth, revenue, sampleSize, baseline } = await revenueWithCounts(ctx);
    const change = growth.value;
    const previous = revenue.comparison?.value ?? 0;

    const thresholdHit = previous > 0 && change >= ctx.thresholds.revenueGrowth;
    const baselineHit =
      baseline !== null && baseline.isAnomaly && baseline.direction === 'above' && baseline.expected > 0;
    if (!thresholdHit && !baselineHit) return [];

    const drivers = await ctx.decompose({ metric: 'revenue', period: ctx.period });
    const pct = Math.round((thresholdHit ? change : baseline!.deviation) * 100);
    return [
      {
        ruleKey: 'revenue_growth',
        type: 'performance',
        severity: 'medium',
        title: thresholdHit
          ? `Crescimento de receita de ${pct}%`
          : `Receita ${pct}% acima do esperado`,
        description: drivers.summary + baselineSentence(ctx, baseline),
        evidence: baseline ? [growth, revenue, baselineEvidence(baseline)] : [growth, revenue],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        impactAmount: thresholdHit ? Math.abs(drivers.delta) : Math.abs(baseline!.delta),
        confidence: confidenceWithBaseline(sampleSize, baseline),
        drivers,
      },
    ];
  },
};

/** One customer concentrates too much of the revenue (dependency risk). */
export const revenueConcentrationRule: Rule = {
  key: 'revenue_concentration',
  async evaluate(ctx) {
    const revenue = await ctx.metrics.calculate('revenue', {
      tenantId: ctx.tenantId,
      period: ctx.period,
      breakdown: { dimension: 'customer' },
    });
    const items = revenue.breakdown?.items ?? [];
    if (items.length < 5 || revenue.value <= 0) return [];

    const top = items[0]!;
    const share = top.value / revenue.value;
    if (share < ctx.thresholds.revenueConcentration) return [];
    if (ctx.isSuppressed('customer', top.key)) return [];

    const label = top.label ?? 'Cliente';
    const event: DetectedEvent = {
      ruleKey: 'revenue_concentration',
      type: 'warning',
      severity: share >= 0.5 ? 'high' : 'medium',
      title: `${formatPercent(share)} da receita vem de um único cliente`,
      description:
        `${label} representou ${formatMoney(top.value, ctx.currency)} de ${formatMoney(revenue.value, ctx.currency)} ` +
        `(${formatPercent(share)}) da receita do período, entre ${items.length} clientes ativos. ` +
        'Uma perda desse cliente teria impacto direto no resultado.',
      evidence: [revenue],
      periodFrom: ctx.period.from,
      periodTo: ctx.period.to,
      entityType: 'customer',
      entityId: top.key,
      entityLabel: label,
      impactAmount: top.value,
      confidence: 0.9,
    };
    return [event];
  },
};
