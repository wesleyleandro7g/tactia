import { formatDelta, formatMoney, formatPercent } from '../format';
import { confidenceFromSample } from '../scoring';
import type { DetectedEvent } from '../types';
import { decimalToNumber, type Rule } from './types';

/** Gross margin fell more than `marginDrop` (only meaningful when products have cost). */
export const marginDropRule: Rule = {
  key: 'margin_drop',
  async evaluate(ctx) {
    const margin = await ctx.metrics.calculate('gross_margin', {
      tenantId: ctx.tenantId,
      period: ctx.period,
      withComparison: true,
    });
    const previous = margin.comparison?.value ?? 0;
    const change = margin.comparison?.change ?? 0;
    if (previous <= 0 || change > ctx.thresholds.marginDrop) return [];

    const [revenue, drivers, salesCount] = await Promise.all([
      ctx.metrics.calculate('revenue', {
        tenantId: ctx.tenantId,
        period: ctx.period,
        withComparison: true,
      }),
      ctx.decompose({ metric: 'gross_margin', period: ctx.period, dimensions: ['product', 'seller'] }),
      ctx.metrics.calculate('sales_count', { tenantId: ctx.tenantId, period: ctx.period }),
    ]);
    const marginRate = revenue.value === 0 ? 0 : margin.value / revenue.value;
    const prevRate =
      (revenue.comparison?.value ?? 0) === 0 ? 0 : previous / (revenue.comparison?.value ?? 1);
    const revenueChange = revenue.comparison?.change ?? 0;
    // Margin dropping faster than revenue = pricing/cost problem, not just volume.
    const structural = change < revenueChange - 0.05;

    return [
      {
        ruleKey: 'margin_drop',
        type: 'anomaly',
        severity: change <= -0.3 ? 'high' : 'medium',
        title: `Margem bruta caiu ${formatDelta(change)}`,
        description:
          `${drivers.summary} A margem passou de ${formatPercent(prevRate)} para ${formatPercent(marginRate)} da receita` +
          (structural
            ? `, caindo mais que a própria receita (${formatDelta(revenueChange)}): sinal de desconto ou custo, não só de volume.`
            : ', acompanhando a variação da receita.'),
        evidence: [margin, revenue],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        impactAmount: Math.abs(margin.value - previous),
        confidence: confidenceFromSample(salesCount.value),
        drivers,
      },
    ];
  },
};

/** Discounts eat more than `discountShare` of gross sales. */
export const discountShareRule: Rule = {
  key: 'discount_share',
  async evaluate(ctx) {
    const [discount, revenue] = await Promise.all([
      ctx.metrics.calculate('discount_total', {
        tenantId: ctx.tenantId,
        period: ctx.period,
        withComparison: true,
      }),
      ctx.metrics.calculate('revenue', {
        tenantId: ctx.tenantId,
        period: ctx.period,
        withComparison: true,
      }),
    ]);
    const gross = revenue.value + discount.value;
    if (gross <= 0) return [];
    const share = discount.value / gross;
    if (share < ctx.thresholds.discountShare) return [];

    const prevGross = (revenue.comparison?.value ?? 0) + (discount.comparison?.value ?? 0);
    const prevShare = prevGross === 0 ? 0 : (discount.comparison?.value ?? 0) / prevGross;
    const excess = discount.value - ctx.thresholds.discountShare * gross;

    const drivers = await ctx.decompose({
      metric: 'discount_total',
      period: ctx.period,
      dimensions: ['seller', 'product'],
    });
    const bySeller = drivers.byDimension.find((d) => d.dimension === 'seller');
    const topSellers = (bySeller?.contributors ?? [])
      .filter((c) => c.current > 0)
      .sort((a, b) => b.current - a.current)
      .slice(0, 3);

    const event: DetectedEvent = {
      ruleKey: 'discount_share',
      type: 'warning',
      severity: share >= ctx.thresholds.discountShare * 2 ? 'high' : 'medium',
      title: `Descontos consomem ${formatPercent(share)} das vendas`,
      description:
        `Foram ${formatMoney(discount.value, ctx.currency)} em descontos sobre ${formatMoney(gross, ctx.currency)} brutos ` +
        `(${formatPercent(share)}; período anterior ${formatPercent(prevShare)}; limite ${formatPercent(ctx.thresholds.discountShare)}). ` +
        `Excesso em relação ao limite: ${formatMoney(excess, ctx.currency)}.` +
        (topSellers.length > 0
          ? ` Quem mais concedeu: ${topSellers.map((s) => `${s.label} (${formatMoney(s.current, ctx.currency)})`).join(', ')}.`
          : ''),
      evidence: [discount, revenue],
      periodFrom: ctx.period.from,
      periodTo: ctx.period.to,
      impactAmount: excess,
      confidence: 0.8,
      drivers,
    };
    return [event];
  },
};

/** Cancelled/refunded share of closed sales above threshold. */
export const cancellationRateRule: Rule = {
  key: 'cancellation_rate',
  async evaluate(ctx) {
    const [cancellation, refund] = await Promise.all([
      ctx.metrics.calculate('cancellation_rate', {
        tenantId: ctx.tenantId,
        period: ctx.period,
        withComparison: true,
      }),
      ctx.metrics.calculate('refund_rate', {
        tenantId: ctx.tenantId,
        period: ctx.period,
        withComparison: true,
      }),
    ]);
    const rate = cancellation.value + refund.value;
    if (rate < ctx.thresholds.cancellationRate) return [];

    const lost = await ctx.db.sale.aggregate({
      where: {
        tenantId: ctx.tenantId,
        status: { in: ['cancelled', 'refunded'] },
        soldAt: { gte: ctx.period.from, lt: ctx.period.to },
      },
      _sum: { totalAmount: true },
      _count: { id: true },
    });
    const lostAmount = decimalToNumber(lost._sum.totalAmount);
    if (lost._count.id < 2) return [];

    const prevRate = (cancellation.comparison?.value ?? 0) + (refund.comparison?.value ?? 0);
    const event: DetectedEvent = {
      ruleKey: 'cancellation_rate',
      type: 'warning',
      severity: rate >= ctx.thresholds.cancellationRate * 2 ? 'high' : 'medium',
      title: `${formatPercent(rate)} das vendas foram canceladas ou reembolsadas`,
      description:
        `${lost._count.id} vendas (${formatMoney(lostAmount, ctx.currency)}) foram canceladas ou reembolsadas no período: ` +
        `${formatPercent(cancellation.value)} de cancelamento e ${formatPercent(refund.value)} de reembolso sobre as vendas encerradas ` +
        `(período anterior: ${formatPercent(prevRate)}; limite ${formatPercent(ctx.thresholds.cancellationRate)}).`,
      evidence: [cancellation, refund],
      periodFrom: ctx.period.from,
      periodTo: ctx.period.to,
      impactAmount: lostAmount,
      confidence: confidenceFromSample(lost._count.id),
    };
    return [event];
  },
};
