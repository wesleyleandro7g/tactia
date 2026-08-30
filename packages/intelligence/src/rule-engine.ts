import type { PrismaClient } from '@tactia/database';
import { MetricEngine } from './metric-engine';
import {
  type DetectedEvent,
  type MetricPeriod,
  type MetricResult,
  type TenantThresholds,
} from './types';

// ---------------------------------------------------------------------------
// Rule context
// ---------------------------------------------------------------------------

export type RuleContext = {
  tenantId: string;
  period: MetricPeriod;
  db: PrismaClient;
  thresholds: TenantThresholds;
};

// ---------------------------------------------------------------------------
// Individual rules
// ---------------------------------------------------------------------------

async function ruleRevenueDrop(ctx: RuleContext, engine: MetricEngine): Promise<DetectedEvent[]> {
  const result = await engine.calculate('revenue_growth', {
    tenantId: ctx.tenantId,
    period: ctx.period,
    withComparison: true,
  });

  const change = result.comparison?.change ?? 0;
  if (change <= ctx.thresholds.revenueDrop) {
    const pct = Math.round(Math.abs(change) * 100);
    return [
      {
        ruleKey: 'revenue_drop',
        type: 'anomaly',
        severity: change <= -0.3 ? 'critical' : 'high',
        title: `Queda de receita de ${pct}%`,
        description: `A receita caiu ${pct}% em relação ao período anterior.`,
        evidence: [result],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
      },
    ];
  }
  return [];
}

async function ruleRevenueGrowth(ctx: RuleContext, engine: MetricEngine): Promise<DetectedEvent[]> {
  const result = await engine.calculate('revenue_growth', {
    tenantId: ctx.tenantId,
    period: ctx.period,
    withComparison: true,
  });

  const change = result.comparison?.change ?? 0;
  if (change >= ctx.thresholds.revenueGrowth) {
    const pct = Math.round(change * 100);
    return [
      {
        ruleKey: 'revenue_growth',
        type: 'performance',
        severity: 'medium',
        title: `Crescimento de receita de ${pct}%`,
        description: `A receita cresceu ${pct}% em relação ao período anterior.`,
        evidence: [result],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
      },
    ];
  }
  return [];
}

async function ruleProductChanges(
  ctx: RuleContext,
  engine: MetricEngine,
): Promise<DetectedEvent[]> {
  const current = await engine.calculate('revenue', {
    tenantId: ctx.tenantId,
    period: ctx.period,
    breakdown: { dimension: 'product' },
  });

  const duration = ctx.period.to.getTime() - ctx.period.from.getTime();
  const prevPeriod: MetricPeriod = {
    from: new Date(ctx.period.from.getTime() - duration),
    to: new Date(ctx.period.to.getTime() - duration),
  };

  const previous = await engine.calculate('revenue', {
    tenantId: ctx.tenantId,
    period: prevPeriod,
    breakdown: { dimension: 'product' },
  });

  const prevMap = new Map<string, number>(
    (previous.breakdown?.items ?? []).map((i) => [i.key, i.value]),
  );

  const events: DetectedEvent[] = [];
  for (const item of current.breakdown?.items ?? []) {
    const prev = prevMap.get(item.key) ?? 0;
    if (prev === 0) continue;
    const change = (item.value - prev) / prev;

    if (change >= ctx.thresholds.productChange) {
      const pct = Math.round(change * 100);
      events.push({
        ruleKey: 'product_growth',
        type: 'performance',
        severity: 'medium',
        title: `Produto com crescimento de ${pct}%`,
        description: `Produto ${item.label ?? item.key} cresceu ${pct}% em receita no período.`,
        evidence: [current, previous],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
      });
    } else if (change <= -ctx.thresholds.productChange) {
      const pct = Math.round(Math.abs(change) * 100);
      events.push({
        ruleKey: 'product_decline',
        type: 'warning',
        severity: 'medium',
        title: `Produto com queda de ${pct}%`,
        description: `Produto ${item.label ?? item.key} caiu ${pct}% em receita no período.`,
        evidence: [current, previous],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
      });
    }
  }
  return events;
}

async function ruleInactiveLeads(ctx: RuleContext): Promise<DetectedEvent[]> {
  const cutoff = new Date(Date.now() - ctx.thresholds.inactiveLeadDays * 24 * 60 * 60 * 1000);
  const count = await ctx.db.lead.count({
    where: {
      tenantId: ctx.tenantId,
      status: { notIn: ['won', 'lost'] },
      activities: {
        none: {
          createdAt: { gte: cutoff },
        },
      },
    },
  });

  if (count > 0) {
    // Produce a synthetic MetricResult-like object for evidence
    const evidence: MetricResult = {
      key: 'inactive_leads_count',
      value: count,
      period: {
        from: ctx.period.from.toISOString(),
        to: ctx.period.to.toISOString(),
      },
    };
    return [
      {
        ruleKey: 'inactive_leads',
        type: 'opportunity',
        severity: count >= 10 ? 'high' : 'medium',
        title: `${count} lead${count > 1 ? 's' : ''} sem atividade há mais de ${ctx.thresholds.inactiveLeadDays} dias`,
        description: `Há ${count} lead${count > 1 ? 's ativos' : ' ativo'} sem nenhuma atividade registrada nos últimos ${ctx.thresholds.inactiveLeadDays} dias.`,
        evidence: [evidence],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
      },
    ];
  }
  return [];
}

async function ruleInactiveCustomers(ctx: RuleContext): Promise<DetectedEvent[]> {
  const cutoff = new Date(
    Date.now() - ctx.thresholds.inactiveCustomerDays * 24 * 60 * 60 * 1000,
  );
  const count = await ctx.db.customer.count({
    where: {
      tenantId: ctx.tenantId,
      status: 'active',
      deletedAt: null,
      sales: {
        none: {
          status: 'confirmed',
          soldAt: { gte: cutoff },
        },
      },
    },
  });

  if (count > 0) {
    const evidence: MetricResult = {
      key: 'inactive_customers_count',
      value: count,
      period: {
        from: ctx.period.from.toISOString(),
        to: ctx.period.to.toISOString(),
      },
    };
    return [
      {
        ruleKey: 'inactive_customers',
        type: 'opportunity',
        severity: count >= 20 ? 'high' : 'medium',
        title: `${count} cliente${count > 1 ? 's' : ''} inativo${count > 1 ? 's' : ''} (sem compra há ${ctx.thresholds.inactiveCustomerDays}+ dias)`,
        description: `Há ${count} cliente${count > 1 ? 's ativos' : ' ativo'} sem compras confirmadas nos últimos ${ctx.thresholds.inactiveCustomerDays} dias.`,
        evidence: [evidence],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
      },
    ];
  }
  return [];
}

async function ruleSellerPerformanceDeviation(
  ctx: RuleContext,
  engine: MetricEngine,
): Promise<DetectedEvent[]> {
  const result = await engine.calculate('revenue', {
    tenantId: ctx.tenantId,
    period: ctx.period,
    breakdown: { dimension: 'seller' },
  });

  const items = result.breakdown?.items ?? [];
  if (items.length < 2) return [];

  const total = items.reduce((s, i) => s + i.value, 0);
  const avg = total / items.length;

  const events: DetectedEvent[] = [];
  for (const item of items) {
    if (avg === 0) continue;
    const deviation = (item.value - avg) / avg;
    if (deviation <= -ctx.thresholds.sellerDeviationFactor) {
      const pct = Math.round(Math.abs(deviation) * 100);
      events.push({
        ruleKey: 'seller_performance_deviation',
        type: 'warning',
        severity: 'medium',
        title: `Vendedor ${pct}% abaixo da média`,
        description: `${item.label ?? item.key} está ${pct}% abaixo da receita média dos vendedores no período.`,
        evidence: [result],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
      });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// RuleEngine
// ---------------------------------------------------------------------------

export class RuleEngine {
  constructor(private readonly engine: MetricEngine) {}

  async evaluate(ctx: RuleContext): Promise<DetectedEvent[]> {
    const allResults = await Promise.allSettled([
      ruleRevenueDrop(ctx, this.engine),
      ruleRevenueGrowth(ctx, this.engine),
      ruleProductChanges(ctx, this.engine),
      ruleInactiveLeads(ctx),
      ruleInactiveCustomers(ctx),
      ruleSellerPerformanceDeviation(ctx, this.engine),
    ]);

    const events: DetectedEvent[] = [];
    for (const result of allResults) {
      if (result.status === 'fulfilled') {
        events.push(...result.value);
      }
      // Individual rule failures are logged but don't abort the pipeline
    }
    return events;
  }
}
