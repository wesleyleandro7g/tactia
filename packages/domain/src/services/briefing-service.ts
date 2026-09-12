import type { PrismaClient } from '@tactia/database';
import type { BriefingRepository } from '@tactia/database';
import { AppError, ErrorCode, logger, type RequestContext } from '@tactia/shared';
import {
  AnalyticsEngine,
  MetricEngine,
  formatMoney,
  formatPercent,
  formatInteger,
} from '@tactia/intelligence';
import { assertTenantContext } from '../authz';
import {
  allowProseSmallInts,
  collectAllowedFromValues,
  unsourcedNumbers as findUnsourcedNumbers,
} from '../ai-safety/numbers';

export type BriefingNarrator = {
  narrate(input: { system: string; user: string }): Promise<{ text: string; model: string }>;
};

export type BriefingFactSet = {
  period: { from: string; to: string };
  currency: string;
  metrics: Array<{ key: string; label: string; value: number; formatted: string; change?: number }>;
  insights: Array<{ title: string; impact?: string; drivers?: string }>;
  projection?: { expected: string; low: string; high: string; method: string };
};

export function collectAllowedNumbers(facts: BriefingFactSet): Set<string> {
  const values: number[] = [];
  const formatted: string[] = [];

  for (const metric of facts.metrics) {
    values.push(metric.value);
    formatted.push(metric.formatted, formatInteger(metric.value));
    if (metric.change != null) {
      values.push(Math.abs(metric.change) * 100);
      formatted.push(`${Math.round(Math.abs(metric.change) * 100)}%`);
    }
  }
  for (const insight of facts.insights) {
    for (const text of [insight.title, insight.impact, insight.drivers]) {
      if (text) formatted.push(text);
    }
  }
  if (facts.projection) {
    formatted.push(facts.projection.expected, facts.projection.low, facts.projection.high);
  }

  return allowProseSmallInts(collectAllowedFromValues(values, formatted));
}

export function unsourcedNumbers(content: string, facts: BriefingFactSet): string[] {
  return findUnsourcedNumbers(content, collectAllowedNumbers(facts));
}

function fallbackNarrative(facts: BriefingFactSet): string {
  const lines = [
    `## Semana ${facts.period.from.slice(0, 10)} a ${facts.period.to.slice(0, 10)}`,
    '',
    '### Números',
    ...facts.metrics.map((m) => `- ${m.label}: ${m.formatted}`),
  ];
  if (facts.projection) {
    lines.push(
      '',
      '### Projeção do mês',
      `- Esperado: ${facts.projection.expected} (faixa ${facts.projection.low}–${facts.projection.high}, ${facts.projection.method})`,
    );
  }
  if (facts.insights.length > 0) {
    lines.push('', '### O que mais importa', ...facts.insights.map((i) => `- ${i.title}${i.drivers ? ` — ${i.drivers}` : ''}`));
  }
  return lines.join('\n');
}

const NARRATOR_SYSTEM =
  'Você escreve o briefing semanal do dono de uma empresa brasileira. ' +
  'Use APENAS os números que aparecem nos fatos. Não invente percentuais, valores ou nomes. ' +
  'Estrutura: 1 parágrafo de recorte da semana, 3–5 bullets de causa/impacto, 1 parágrafo do que fazer. ' +
  'Markdown. Tom direto, sem marketing.';

/**
 * Weekly briefing: assemble deterministic facts, ask the LLM to narrate,
 * reject any number that is not in the fact set (one retry), persist.
 */
export class BriefingService {
  private readonly metrics: MetricEngine;
  private readonly analytics: AnalyticsEngine;

  constructor(
    private readonly db: PrismaClient,
    private readonly briefings: BriefingRepository,
    private readonly narrator: BriefingNarrator | null = null,
  ) {
    this.metrics = new MetricEngine(db);
    this.analytics = new AnalyticsEngine(db);
  }

  async generateForTenant(tenantId: string, now = new Date()) {
    const tenant = await this.db.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true },
    });
    const currency = tenant?.currency ?? 'BRL';
    const periodTo = now;
    const periodFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const facts = await this.collectFacts(tenantId, { from: periodFrom, to: periodTo }, currency);
    const sources = facts.metrics.map((m) => ({
      metric: m.key,
      period: facts.period,
      value: m.value,
    }));

    let content = fallbackNarrative(facts);
    let model = 'deterministic';

    if (this.narrator) {
      const user = `Fatos (use somente estes números):\n${JSON.stringify(facts, null, 2)}`;
      try {
        const first = await this.narrator.narrate({ system: NARRATOR_SYSTEM, user });
        const bad = unsourcedNumbers(first.text, facts);
        if (bad.length === 0) {
          content = first.text;
          model = first.model;
        } else {
          logger.warn({ tenant_id: tenantId, operation: 'briefing_numbers_rejected', bad });
          const retry = await this.narrator.narrate({
            system: NARRATOR_SYSTEM,
            user:
              `${user}\n\nA versão anterior inventou estes números: ${bad.join(', ')}. ` +
              'Reescreva sem eles. Só use valores que estão nos fatos.',
          });
          const stillBad = unsourcedNumbers(retry.text, facts);
          if (stillBad.length === 0) {
            content = retry.text;
            model = retry.model;
          } else {
            logger.warn({ tenant_id: tenantId, operation: 'briefing_fallback', stillBad });
          }
        }
      } catch (error) {
        logger.warn({
          tenant_id: tenantId,
          operation: 'briefing_narrator_failed',
          err: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return this.briefings.create({
      tenantId,
      periodFrom,
      periodTo,
      content,
      facts,
      sources,
      model,
    });
  }

  async generate(ctx: RequestContext, now = new Date()) {
    assertTenantContext(ctx);
    return this.generateForTenant(ctx.tenantId, now);
  }

  async latest(ctx: RequestContext) {
    assertTenantContext(ctx);
    return this.briefings.findLatest({ tenantId: ctx.tenantId });
  }

  async list(ctx: RequestContext) {
    assertTenantContext(ctx);
    return this.briefings.list({ tenantId: ctx.tenantId });
  }

  async getById(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const row = await this.briefings.findById({ tenantId: ctx.tenantId, id });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Briefing not found');
    return row;
  }

  private async collectFacts(
    tenantId: string,
    period: { from: Date; to: Date },
    currency: string,
  ): Promise<BriefingFactSet> {
    const monthStart = new Date(Date.UTC(period.to.getUTCFullYear(), period.to.getUTCMonth(), 1));
    const keys = ['revenue', 'sales_count', 'gross_margin', 'discount_total', 'complaint_count'] as const;
    const [week, month, insights, projection] = await Promise.all([
      Promise.all(keys.map((key) => this.metrics.calculate(key, { tenantId, period, withComparison: true }))),
      Promise.all(
        keys.map((key) =>
          this.metrics.calculate(key, { tenantId, period: { from: monthStart, to: period.to }, withComparison: true }),
        ),
      ),
      this.db.insight.findMany({
        where: { tenantId, status: 'open' },
        orderBy: { score: 'desc' },
        take: 5,
        select: { title: true, impactAmount: true, drivers: true },
      }),
      this.analytics.getPeriodProjection(tenantId, { from: monthStart, to: new Date(Date.UTC(period.to.getUTCFullYear(), period.to.getUTCMonth() + 1, 1)) }),
    ]);

    const label: Record<string, string> = {
      revenue: 'Receita',
      sales_count: 'Vendas',
      gross_margin: 'Margem bruta',
      discount_total: 'Descontos',
      complaint_count: 'Reclamações',
    };

    const metrics = [
      ...week.map((m) => ({
        key: `week.${m.key}`,
        label: `${label[m.key] ?? m.key} (7d)`,
        value: m.value,
        formatted: m.key.includes('count') || m.key.includes('rate') || m.key === 'gross_margin'
          ? m.key === 'gross_margin'
            ? formatPercent(m.value)
            : formatInteger(m.value)
          : formatMoney(m.value, currency),
        change: m.comparison?.change,
      })),
      ...month.map((m) => ({
        key: `mtd.${m.key}`,
        label: `${label[m.key] ?? m.key} (mês)`,
        value: m.value,
        formatted:
          m.key === 'gross_margin'
            ? formatPercent(m.value)
            : m.key.includes('count')
              ? formatInteger(m.value)
              : formatMoney(m.value, currency),
        change: m.comparison?.change,
      })),
    ];

    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      currency,
      metrics,
      insights: insights.map((insight) => {
        const drivers = insight.drivers as { summary?: string } | null;
        const impact =
          insight.impactAmount != null
            ? formatMoney(Number(insight.impactAmount), currency)
            : undefined;
        return { title: insight.title, impact, drivers: drivers?.summary };
      }),
      projection: {
        expected: formatMoney(projection.projection.revenue.expected, currency),
        low: formatMoney(projection.projection.revenue.low, currency),
        high: formatMoney(projection.projection.revenue.high, currency),
        method: projection.projection.method,
      },
    };
  }
}
