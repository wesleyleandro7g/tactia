import { Prisma } from '@tactia/database';
import { describeBaseline } from '../baseline';
import { formatMoney, formatPercent } from '../format';
import { confidenceFromSample, isMaterial } from '../scoring';
import type { DetectedEvent } from '../types';
import { baselineEvidence } from './revenue';
import type { Rule } from './types';

export const sellerPerformanceDeviationRule: Rule = {
  key: 'seller_performance_deviation',
  async evaluate(ctx) {
    const [result, previous] = await Promise.all([
      ctx.metrics.calculate('revenue', {
        tenantId: ctx.tenantId,
        period: ctx.period,
        breakdown: { dimension: 'seller' },
      }),
      ctx.metrics.calculate('revenue', {
        tenantId: ctx.tenantId,
        period: ctx.previousPeriod,
        breakdown: { dimension: 'seller' },
      }),
    ]);

    const items = result.breakdown?.items ?? [];
    if (items.length < 2) return [];
    const prevMap = new Map((previous.breakdown?.items ?? []).map((i) => [i.key, i.value]));

    const total = items.reduce((s, i) => s + i.value, 0);
    const avg = total / items.length;
    if (avg === 0) return [];

    const counts = await ctx.db.sale.groupBy({
      by: ['sellerId'],
      where: {
        tenantId: ctx.tenantId,
        status: 'confirmed',
        soldAt: { gte: ctx.period.from, lt: ctx.period.to },
      },
      _count: { id: true },
    });
    const countMap = new Map(counts.map((c) => [c.sellerId ?? 'unknown', c._count.id]));

    const events: DetectedEvent[] = [];
    for (const item of items) {
      if (item.key === 'unknown' || ctx.isSuppressed('seller', item.key)) continue;
      const deviation = (item.value - avg) / avg;
      if (deviation > -ctx.thresholds.sellerDeviationFactor) continue;
      // A seller who never sold anything (new hire, wrong mapping) is not a
      // performance deviation — the seller needs history to be compared.
      const prev = prevMap.get(item.key) ?? 0;
      if (prev === 0 && item.value === 0) continue;

      const label = item.label ?? item.key;
      const gap = avg - item.value;
      // Own history: a seller who always sells less than peers (junior, part-time)
      // is not a deviation unless he is also below his own baseline.
      const baseline = await ctx.baselineFor({
        metric: 'revenue',
        entity: { dimension: 'seller', key: item.key },
      });
      if (baseline && baseline.expected > 0 && baseline.deviation > -0.1 && deviation > -0.7) continue;
      const reference = baseline
        ? ` Histórico próprio: ${describeBaseline(baseline, (v) => formatMoney(v, ctx.currency))}.`
        : '';
      events.push({
        ruleKey: 'seller_performance_deviation',
        type: 'warning',
        severity: deviation <= -0.7 ? 'high' : 'medium',
        title: `${label} está ${formatPercent(Math.abs(deviation))} abaixo da média`,
        description:
          `${label} vendeu ${formatMoney(item.value, ctx.currency)} contra uma média de ${formatMoney(avg, ctx.currency)} por vendedor no período` +
          (prev > 0
            ? ` (no período anterior havia vendido ${formatMoney(prev, ctx.currency)}).`
            : '.') +
          ` Diferença para a média: ${formatMoney(gap, ctx.currency)}.` +
          reference,
        evidence: baseline ? [result, baselineEvidence(baseline)] : [result],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'seller',
        entityId: item.key,
        entityLabel: label,
        impactAmount: gap,
        confidence: confidenceFromSample(countMap.get(item.key) ?? 0),
      });
    }
    return events;
  },
};

type SellerMarginRow = {
  seller_id: string;
  name: string;
  revenue: string;
  discount: string;
  margin: string;
  cost_known: string;
};

/** Cross-signal: a seller that discounts far more than peers while eroding margin. */
export const sellerHighDiscountLowMarginRule: Rule = {
  key: 'seller_high_discount_low_margin',
  async evaluate(ctx) {
    const rows = await ctx.db.$queryRaw<SellerMarginRow[]>(Prisma.sql`
      SELECT sel.id AS seller_id, sel.name,
             COALESCE(SUM(s.total_amount), 0)::text AS revenue,
             COALESCE(SUM(s.discount_amount), 0)::text AS discount,
             COALESCE(SUM(si.total_amount - si.quantity * COALESCE(p.cost, 0)), 0)::text AS margin,
             COUNT(p.cost)::text AS cost_known
      FROM sellers sel
      INNER JOIN sales s ON s.seller_id = sel.id AND s.status = 'confirmed'
        AND s.sold_at >= ${ctx.period.from} AND s.sold_at < ${ctx.period.to}
      LEFT JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE sel.tenant_id = ${ctx.tenantId}::uuid AND sel.deleted_at IS NULL
      GROUP BY sel.id, sel.name
    `);
    if (rows.length < 2) return [];

    const sellers = rows.map((row) => {
      const revenue = parseFloat(row.revenue);
      const discount = parseFloat(row.discount);
      const margin = parseFloat(row.margin);
      return {
        id: row.seller_id,
        name: row.name,
        revenue,
        discount,
        margin,
        costKnown: parseInt(row.cost_known, 10) > 0,
        discountShare: revenue + discount === 0 ? 0 : discount / (revenue + discount),
        marginRate: revenue === 0 ? 0 : margin / revenue,
      };
    });
    const totalRevenue = sellers.reduce((s, r) => s + r.revenue, 0);
    const totalDiscount = sellers.reduce((s, r) => s + r.discount, 0);
    const avgDiscountShare =
      totalRevenue + totalDiscount === 0 ? 0 : totalDiscount / (totalRevenue + totalDiscount);
    const withCost = sellers.filter((s) => s.costKnown && s.revenue > 0);
    const avgMarginRate =
      withCost.length === 0
        ? null
        : withCost.reduce((s, r) => s + r.margin, 0) / withCost.reduce((s, r) => s + r.revenue, 0);

    const events: DetectedEvent[] = [];
    for (const seller of sellers) {
      if (ctx.isSuppressed('seller', seller.id)) continue;
      if (!isMaterial(seller.revenue, totalRevenue)) continue;
      const discountTooHigh =
        seller.discountShare >= ctx.thresholds.discountShare &&
        seller.discountShare >= avgDiscountShare * 1.5;
      const marginTooLow =
        avgMarginRate == null || !seller.costKnown ? true : seller.marginRate < avgMarginRate * 0.8;
      if (!discountTooHigh || !marginTooLow) continue;

      const excess = seller.discount - avgDiscountShare * (seller.revenue + seller.discount);
      events.push({
        ruleKey: 'seller_high_discount_low_margin',
        type: 'warning',
        severity: 'medium',
        title: `${seller.name} concede ${formatPercent(seller.discountShare)} de desconto (média ${formatPercent(avgDiscountShare)})`,
        description:
          `${seller.name} deu ${formatMoney(seller.discount, ctx.currency)} em descontos sobre ${formatMoney(seller.revenue, ctx.currency)} de receita ` +
          `(${formatPercent(seller.discountShare)} vs. ${formatPercent(avgDiscountShare)} da equipe)` +
          (avgMarginRate != null && seller.costKnown
            ? `, com margem de ${formatPercent(seller.marginRate)} contra ${formatPercent(avgMarginRate)} da equipe.`
            : '.') +
          ` Desconto acima da média da equipe: ${formatMoney(Math.max(0, excess), ctx.currency)}.`,
        evidence: [
          {
            key: 'discount_total',
            value: seller.discount,
            period: { from: ctx.period.from.toISOString(), to: ctx.period.to.toISOString() },
          },
        ],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'seller',
        entityId: seller.id,
        entityLabel: seller.name,
        impactAmount: Math.max(0, excess),
        confidence: 0.7,
      });
    }
    return events;
  },
};
