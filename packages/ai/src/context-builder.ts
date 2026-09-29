import type { Drivers, MetricResult } from '@tactia/intelligence';
import type { InsightService, MetricService, TenantService } from '@tactia/domain';
import { logger } from '@tactia/shared';
import { currentMonthPeriod, sourceFromMetric } from './tools/shared';
import type { MessageSource, ToolContext } from './types';

/** Optional providers that enrich the context as later stages land. */
export type ContextProviders = {
  /** Active goals with progress (Etapa 12). */
  goals?: (ctx: ToolContext) => Promise<ContextGoal[]>;
  /** Business facts declared by the user (Etapa 12 / 15). Retrieved by query similarity. */
  facts?: (ctx: ToolContext, query: string) => Promise<ContextFact[]>;
  /** Latest weekly briefing (Etapa 11). */
  briefing?: (ctx: ToolContext) => Promise<ContextBriefing | null>;
  /** Company playbooks retrieved by query similarity (Etapa 15). */
  playbooks?: (ctx: ToolContext, query: string) => Promise<ContextPlaybook[]>;
  /** Compact custom-field catalog summary (keys only — details via get_data_catalog). */
  customFields?: (ctx: ToolContext) => Promise<ContextCustomFields | null | undefined>;
  /** Optional company-wide guidance plus progressive-disclosure skill catalog. */
  agentSkills?: (ctx: ToolContext) => Promise<ContextAgentSkills>;
};

export type ContextBuilderDeps = {
  tenants: TenantService;
  metrics: MetricService;
  insights: InsightService;
  providers?: ContextProviders;
};

export type ContextMetric = {
  key: string;
  value: number;
  change?: number;
  direction?: 'up' | 'down' | 'flat';
  /** Previous-period value, when compared. */
  previous?: number;
};

export type ContextInsight = {
  id: string;
  ruleKey: string;
  type: string;
  severity: string;
  title: string;
  impactAmount?: number | null;
  score?: number;
  entityType?: string | null;
  entityId?: string | null;
  /** One-line root-cause summary ("71% da queda vem de X e Y"). */
  driversSummary?: string | null;
  /** Top contributors, for the model to name names without calling a tool. */
  topDrivers?: Array<{ label: string; delta: number; share: number }>;
};

export type ContextGoal = {
  id: string;
  metricKey: string;
  scope: string;
  scopeLabel?: string | null;
  period?: { from: string; to: string };
  target: number;
  achieved: number;
  progress: number;
  requiredDailyPace: number | null;
  projected: number | null;
  onTrack: boolean | null;
  periodEnd: string;
};

export type ContextFact = {
  id: string;
  kind: string;
  text: string;
  validFrom?: string | null;
  validTo?: string | null;
};

export type ContextBriefing = {
  id: string;
  periodFrom: string;
  periodTo: string;
  createdAt: string;
  headline: string;
};

export type ContextPlaybook = {
  id: string;
  slug: string;
  title: string;
  trigger: string;
};

export type ContextAgentSkills = {
  globalMarkdown: string | null;
  catalog: Array<{
    slug: string;
    title: string;
    description: string;
    resourceTypes: string[];
  }>;
};

export type ContextCustomFields = {
  total: number;
  byEntity: Array<{ entityType: string; label: string; count: number; keys: string[] }>;
};

export type AiContext = {
  company: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    today: string;
    /** pt-BR weekday name, e.g. "quarta-feira". */
    weekday: string;
    /** Days remaining in the current month, including today. */
    daysLeftInMonth: number;
    daysElapsedInMonth: number;
  };
  /** Month-to-date period (the default period of every tool). */
  period: { from: string; to: string };
  /** Key metrics month-to-date, compared to the same window of the previous month. */
  metrics: ContextMetric[];
  /** Same metrics over the trailing 30 days, compared to the 30 days before. */
  trailing30: ContextMetric[];
  trailingPeriod: { from: string; to: string };
  /** Top open insights by score, with impact and drivers. */
  insights: ContextInsight[];
  goals: ContextGoal[];
  facts: ContextFact[];
  playbooks: ContextPlaybook[];
  briefing: ContextBriefing | null;
  /** Compact list of tenant-defined fields; omitted when none exist. */
  customFields?: ContextCustomFields | null;
  agentSkills?: ContextAgentSkills;
  /** Evidence for everything above — carried into the answer metadata (spec §43). */
  sources: MessageSource[];
};

export const CONTEXT_METRICS = [
  'revenue',
  'sales_count',
  'average_ticket',
  'customer_count',
  'new_customers',
  'gross_margin',
  'discount_total',
  'pending_amount',
  'complaint_count',
  'cancellation_rate',
] as const;

const WEEKDAYS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

function toMetric(result: MetricResult): ContextMetric {
  return {
    key: result.key,
    value: result.value,
    change: result.comparison?.change,
    direction: result.comparison?.direction,
    previous: result.comparison?.value,
  };
}

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeDrivers(drivers: unknown): {
  summary: string | null;
  top: Array<{ label: string; delta: number; share: number }>;
} {
  const parsed = drivers as Drivers | null | undefined;
  if (!parsed || !Array.isArray(parsed.byDimension)) return { summary: null, top: [] };
  const best = [...parsed.byDimension]
    .filter((d) => d.contributors.length > 0)
    .sort((a, b) => b.explainedShare - a.explainedShare)[0];
  const top = (best?.contributors ?? [])
    .filter((c) => Math.sign(c.delta) === Math.sign(parsed.delta) || parsed.delta === 0)
    .slice(0, 3)
    .map((c) => ({ label: c.label, delta: c.delta, share: c.share }));
  return { summary: parsed.summary ?? null, top };
}

/**
 * Context Builder (spec §41).
 *
 * Assembles the structured context injected into the system prompt: company
 * profile, key metrics (month-to-date and trailing 30 days), top open insights
 * with impact and drivers, goals, business facts and the latest briefing. The
 * LLM starts every turn already knowing the shape of the business.
 */
export class ContextBuilder {
  constructor(private readonly deps: ContextBuilderDeps) {}

  private async metricsFor(
    ctx: ToolContext,
    period: { from: Date; to: Date },
  ): Promise<MetricResult[]> {
    const results = await Promise.all(
      CONTEXT_METRICS.map(async (key) => {
        try {
          return (await this.deps.metrics.calculate(ctx, key, {
            period,
            withComparison: true,
          })) as MetricResult;
        } catch (error) {
          // A failing metric must not break the chat — it just won't be in context.
          logger.warn({ tenant_id: ctx.tenantId, metric: key, err: error }, 'context metric failed');
          return null;
        }
      }),
    );
    return results.filter((result): result is MetricResult => result != null);
  }

  async build(
    ctx: ToolContext,
    options: { period?: { from: Date; to: Date }; query?: string } = {},
  ) {
    const now = new Date();
    const period = options.period ?? currentMonthPeriod(now);
    const trailingPeriod = {
      from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      to: now,
    };
    const query = options.query ?? '';

    const tenant = await this.deps.tenants.get(ctx, ctx.tenantId);

    const [mtd, trailing, insightPage, goals, facts, briefing, playbooks, customFields, agentSkills] = await Promise.all([
      this.metricsFor(ctx, period),
      this.metricsFor(ctx, trailingPeriod),
      this.deps.insights.list(ctx, { status: 'open', page: '1', pageSize: '5', orderBy: 'score' }),
      this.safe(ctx, 'goals', () => this.deps.providers?.goals?.(ctx) ?? Promise.resolve([])),
      this.safe(ctx, 'facts', () => this.deps.providers?.facts?.(ctx, query) ?? Promise.resolve([])),
      this.safe(ctx, 'briefing', () => this.deps.providers?.briefing?.(ctx) ?? Promise.resolve(null)),
      this.safe(ctx, 'playbooks', () => this.deps.providers?.playbooks?.(ctx, query) ?? Promise.resolve([])),
      this.safe(ctx, 'customFields', () => this.deps.providers?.customFields?.(ctx) ?? Promise.resolve(null)),
      this.safe(ctx, 'agentSkills', () => this.deps.providers?.agentSkills?.(ctx) ?? Promise.resolve({ globalMarkdown: null, catalog: [] })),
    ]);

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const context: AiContext = {
      company: {
        id: tenant.id,
        name: tenant.name,
        currency: tenant.currency,
        timezone: tenant.timezone,
        today: now.toISOString().slice(0, 10),
        weekday: WEEKDAYS[now.getDay()] ?? '',
        daysLeftInMonth: daysInMonth - now.getDate() + 1,
        daysElapsedInMonth: now.getDate(),
      },
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      metrics: mtd.map(toMetric),
      trailing30: trailing.map(toMetric),
      trailingPeriod: {
        from: trailingPeriod.from.toISOString(),
        to: trailingPeriod.to.toISOString(),
      },
      insights: insightPage.items.map((insight) => {
        const drivers = summarizeDrivers(insight.drivers);
        return {
          id: insight.id,
          ruleKey: insight.ruleKey,
          type: insight.type,
          severity: insight.severity,
          title: insight.title,
          impactAmount: decimalToNumber(insight.impactAmount),
          score: insight.score,
          entityType: insight.entityType,
          entityId: insight.entityId,
          driversSummary: drivers.summary,
          topDrivers: drivers.top,
        };
      }),
      goals: goals ?? [],
      facts: facts ?? [],
      playbooks: playbooks ?? [],
      briefing: briefing ?? null,
      customFields: customFields && customFields.total > 0 ? customFields : null,
      agentSkills: agentSkills ?? { globalMarkdown: null, catalog: [] },
      sources: [
        ...mtd.map((result) => sourceFromMetric(result, 'context')),
        ...trailing.map((result) => sourceFromMetric(result, 'context')),
        ...(goals ?? []).map((goal) => {
          const isRate = ['cancellation_rate', 'refund_rate', 'sales_growth', 'revenue_growth'].includes(goal.metricKey);
          return {
            metric: 'goal_progress',
            period: goal.period,
            value: goal.achieved,
            tool: 'context',
            label: `Meta de ${goal.metricKey}`,
            refId: goal.id,
            numericEvidence: [
              ...[goal.target, goal.achieved, goal.requiredDailyPace]
                .filter((value): value is number => value != null)
                .map((value) => ({ value: isRate ? value * 100 : value, unit: isRate ? 'percent' as const : 'number' as const, kind: 'observed' as const, metric: goal.metricKey, period: goal.period })),
              ...(goal.projected != null ? [{ value: isRate ? goal.projected * 100 : goal.projected, unit: isRate ? 'percent' as const : 'number' as const, kind: 'estimated' as const, metric: goal.metricKey, period: goal.period }] : []),
              {
                value: goal.progress * 100,
                unit: 'percent' as const,
                kind: 'observed' as const,
                metric: goal.metricKey,
                period: goal.period,
              },
            ],
          };
        }),
      ],
    };

    context.sources.push(...context.insights.map((insight) => ({
      metric: 'insight',
      tool: 'context',
      refId: insight.id,
      label: insight.title,
      numericEvidence: [
        ...(insight.impactAmount != null ? [{
          value: insight.impactAmount,
          unit: 'number' as const,
          kind: 'estimated' as const,
          metric: 'impact_amount',
        }] : []),
        ...(insight.topDrivers ?? []).flatMap((driver) => [
          { value: driver.delta, unit: 'number' as const, kind: 'observed' as const, metric: 'insight_driver' },
          { value: driver.share * 100, unit: 'percent' as const, kind: 'observed' as const, metric: 'insight_driver' },
        ]),
      ],
    })));

    return context;
  }

  private async safe<T>(ctx: ToolContext, name: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      logger.warn({ tenant_id: ctx.tenantId, provider: name, err: error }, 'context provider failed');
      return null;
    }
  }
}
