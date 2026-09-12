import type { Rule } from './types';

export const stockoutRiskRule: Rule = {
  key: 'stockout_risk',
  async evaluate(ctx) {
    const latest = await ctx.db.inventoryLevel.findMany({
      where: { tenantId: ctx.tenantId },
      distinct: ['productId'],
      orderBy: { recordedAt: 'desc' },
      include: { product: { select: { name: true } } },
      take: 200,
    });
    if (latest.length === 0) return [];
    const velocity = await ctx.db.saleItem.groupBy({
      by: ['productId'],
      where: {
        tenantId: ctx.tenantId,
        sale: { status: 'confirmed', soldAt: { gte: ctx.previousPeriod.from, lt: ctx.period.to } },
      },
      _sum: { quantity: true },
    });
    const days = Math.max(1, (ctx.period.to.getTime() - ctx.previousPeriod.from.getTime()) / (24 * 60 * 60 * 1000));
    const vel = new Map(velocity.map((row) => [row.productId, Number(row._sum.quantity ?? 0) / days]));
    const events = [];
    for (const row of latest) {
      const daily = vel.get(row.productId) ?? 0;
      if (daily <= 0) continue;
      const cover = Number(row.quantity) / daily;
      if (cover >= ctx.thresholds.stockCoverDays) continue;
      events.push({
        ruleKey: 'stockout_risk',
        type: 'warning' as const,
        severity: cover < 7 ? 'high' as const : 'medium' as const,
        title: `${row.product.name}: estoque para ${Math.round(cover)} dias`,
        description: `Cobertura abaixo de ${ctx.thresholds.stockCoverDays} dias no ritmo atual de vendas.`,
        evidence: [],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'product',
        entityId: row.productId,
        entityLabel: row.product.name,
        impactAmount: daily * 14,
        confidence: 0.7,
      });
    }
    return events.slice(0, 8);
  },
};

export const deadStockRule: Rule = {
  key: 'dead_stock',
  async evaluate(ctx) {
    const latest = await ctx.db.inventoryLevel.findMany({
      where: { tenantId: ctx.tenantId },
      distinct: ['productId'],
      orderBy: { recordedAt: 'desc' },
      include: { product: { select: { name: true } } },
      take: 200,
    });
    const cutoff = new Date(ctx.period.to.getTime() - ctx.thresholds.deadStockDays * 24 * 60 * 60 * 1000);
    const events = [];
    for (const row of latest) {
      if (Number(row.quantity) <= 0) continue;
      const sold = await ctx.db.saleItem.count({
        where: {
          tenantId: ctx.tenantId,
          productId: row.productId,
          sale: { status: 'confirmed', soldAt: { gte: cutoff, lt: ctx.period.to } },
        },
      });
      if (sold > 0) continue;
      events.push({
        ruleKey: 'dead_stock',
        type: 'opportunity' as const,
        severity: 'low' as const,
        title: `${row.product.name}: estoque parado`,
        description: `Sem venda nos últimos ${ctx.thresholds.deadStockDays} dias e ainda há ${Number(row.quantity)} unidades.`,
        evidence: [],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'product',
        entityId: row.productId,
        entityLabel: row.product.name,
        impactAmount: Number(row.quantity),
        confidence: 0.65,
      });
    }
    return events.slice(0, 8);
  },
};
