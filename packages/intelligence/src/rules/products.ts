import { describeBaseline } from '../baseline';
import { formatDelta, formatMoney } from '../format';
import { confidenceFromSample, isMaterial } from '../scoring';
import type { DetectedEvent, MetricResult } from '../types';
import { baselineEvidence } from './revenue';
import type { Rule, RuleContext } from './types';

type ProductChange = {
  productId: string;
  label: string;
  current: number;
  previous: number;
  change: number;
};

async function productChanges(ctx: RuleContext): Promise<{
  changes: ProductChange[];
  current: MetricResult;
  previous: MetricResult;
}> {
  const [current, previous] = await Promise.all([
    ctx.metrics.calculate('revenue', {
      tenantId: ctx.tenantId,
      period: ctx.period,
      breakdown: { dimension: 'product' },
    }),
    ctx.metrics.calculate('revenue', {
      tenantId: ctx.tenantId,
      period: ctx.previousPeriod,
      breakdown: { dimension: 'product' },
    }),
  ]);

  const prevMap = new Map((previous.breakdown?.items ?? []).map((i) => [i.key, i]));
  const total = Math.max(current.value, previous.value);
  const changes: ProductChange[] = [];
  for (const item of current.breakdown?.items ?? []) {
    const prev = prevMap.get(item.key)?.value ?? 0;
    if (prev === 0) continue;
    // Materiality: ignore products that are noise at tenant scale.
    if (!isMaterial(Math.max(prev, item.value), total)) continue;
    changes.push({
      productId: item.key,
      label: item.label ?? item.key,
      current: item.value,
      previous: prev,
      change: (item.value - prev) / prev,
    });
  }
  // Products that stopped selling entirely.
  const currentKeys = new Set((current.breakdown?.items ?? []).map((i) => i.key));
  for (const item of previous.breakdown?.items ?? []) {
    if (currentKeys.has(item.key)) continue;
    if (!isMaterial(item.value, total)) continue;
    changes.push({
      productId: item.key,
      label: item.label ?? item.key,
      current: 0,
      previous: item.value,
      change: -1,
    });
  }
  return { changes, current, previous };
}

async function unitsFor(ctx: RuleContext, productId: string): Promise<number> {
  const rows = await ctx.db.saleItem.aggregate({
    where: {
      tenantId: ctx.tenantId,
      productId,
      sale: {
        status: 'confirmed',
        soldAt: { gte: ctx.previousPeriod.from, lt: ctx.period.to },
      },
    },
    _count: { id: true },
  });
  return rows._count.id;
}

export const productChangesRule: Rule = {
  key: 'product_changes',
  async evaluate(ctx) {
    const { changes, current, previous } = await productChanges(ctx);
    const events: DetectedEvent[] = [];

    for (const change of changes) {
      if (ctx.isSuppressed('product', change.productId)) continue;
      const thresholdHit = Math.abs(change.change) >= ctx.thresholds.productChange;
      // Baseline gate: with history, a swing must also be statistically unusual
      // for this product (|z| ≥ anomalyZScore) — or be large enough on its own.
      const baseline = await ctx.baselineFor({
        metric: 'revenue',
        entity: { dimension: 'product', key: change.productId },
      });
      const baselineHit = baseline !== null && baseline.isAnomaly;
      if (!thresholdHit && !baselineHit) continue;
      if (baseline && !baselineHit && Math.abs(change.change) < ctx.thresholds.productChange * 2) {
        // Within normal variance for this product: skip unless the swing is extreme.
        continue;
      }
      const delta = change.current - change.previous;
      const sample = await unitsFor(ctx, change.productId);
      const reference = baseline
        ? ` Referência: ${describeBaseline(baseline, (v) => formatMoney(v, ctx.currency))}.`
        : '';
      const base = {
        evidence: baseline ? [current, previous, baselineEvidence(baseline)] : [current, previous],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'product',
        entityId: change.productId,
        entityLabel: change.label,
        impactAmount: Math.abs(delta),
        confidence: confidenceFromSample(sample),
      };
      if (delta > 0) {
        events.push({
          ...base,
          ruleKey: 'product_growth',
          type: 'performance',
          severity: 'medium',
          title: `${change.label} cresceu ${formatDelta(change.change)}`,
          description:
            `${change.label} passou de ${formatMoney(change.previous, ctx.currency)} para ` +
            `${formatMoney(change.current, ctx.currency)} em receita (${formatDelta(change.change)}, ` +
            `+${formatMoney(delta, ctx.currency)}) em relação ao período anterior.` +
            reference,
        });
      } else {
        events.push({
          ...base,
          ruleKey: 'product_decline',
          type: 'warning',
          severity: change.change <= -0.5 ? 'high' : 'medium',
          title:
            change.current === 0
              ? `${change.label} parou de vender`
              : `${change.label} caiu ${formatDelta(change.change)}`,
          description:
            change.current === 0
              ? `${change.label} vendeu ${formatMoney(change.previous, ctx.currency)} no período anterior e nada neste período.`
              : `${change.label} passou de ${formatMoney(change.previous, ctx.currency)} para ` +
                `${formatMoney(change.current, ctx.currency)} em receita (${formatDelta(change.change)}, ` +
                `-${formatMoney(Math.abs(delta), ctx.currency)}) em relação ao período anterior.` +
                reference,
        });
      }
    }
    return events;
  },
};

/**
 * Cross-signal: a product in decline that also shows up in complaints. Uses the
 * `product_id` set by the classifier when available, and falls back to the
 * product name appearing in the complaint text.
 */
export const productDeclineWithComplaintsRule: Rule = {
  key: 'product_decline_with_complaints',
  async evaluate(ctx) {
    const { changes, current, previous } = await productChanges(ctx);
    const declining = changes.filter((c) => c.change <= -ctx.thresholds.productChange);
    if (declining.length === 0) return [];

    const events: DetectedEvent[] = [];
    for (const change of declining) {
      if (ctx.isSuppressed('product', change.productId)) continue;
      const complaints = await ctx.db.interaction.count({
        where: {
          tenantId: ctx.tenantId,
          intent: 'complaint',
          occurredAt: { gte: ctx.previousPeriod.from, lt: ctx.period.to },
          OR: [
            { productId: change.productId },
            { body: { contains: change.label, mode: 'insensitive' } },
          ],
        },
      });
      if (complaints < 2) continue;

      const delta = change.previous - change.current;
      events.push({
        ruleKey: 'product_decline_with_complaints',
        type: 'anomaly',
        severity: 'high',
        title: `${change.label}: queda de ${formatDelta(change.change)} com ${complaints} reclamações`,
        description:
          `${change.label} caiu de ${formatMoney(change.previous, ctx.currency)} para ${formatMoney(change.current, ctx.currency)} ` +
          `e acumulou ${complaints} reclamações de clientes no mesmo intervalo. A queda pode ter causa em qualidade, entrega ou preço — ` +
          'leia as reclamações antes de agir em marketing.',
        evidence: [
          current,
          previous,
          {
            key: 'complaint_count',
            value: complaints,
            period: { from: ctx.previousPeriod.from.toISOString(), to: ctx.period.to.toISOString() },
          },
        ],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'product',
        entityId: change.productId,
        entityLabel: change.label,
        impactAmount: delta,
        confidence: 0.8,
      });
    }
    return events;
  },
};
