import type { MetricResult } from '@tactia/intelligence';
import type { InsightService, MetricService, TenantService } from '@tactia/domain';
import { logger } from '@tactia/shared';
import { currentMonthPeriod, sourceFromMetric } from './tools/shared';
import type { MessageSource, ToolContext } from './types';

export type ContextBuilderDeps = {
  tenants: TenantService;
  metrics: MetricService;
  insights: InsightService;
};

export type AiContext = {
  company: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    today: string;
  };
  period: { from: string; to: string };
  /** Key metrics of the period, already compared to the previous period. */
  metrics: Array<{
    key: string;
    value: number;
    change?: number;
    direction?: 'up' | 'down' | 'flat';
  }>;
  insights: Array<{
    id: string;
    ruleKey: string;
    type: string;
    severity: string;
    title: string;
  }>;
  /** Evidence for everything above — carried into the answer metadata (spec §43). */
  sources: MessageSource[];
};

const CONTEXT_METRICS = ['revenue', 'sales_count', 'average_ticket', 'customer_count'] as const;

/**
 * Context Builder (spec §41).
 *
 * Assembles the structured context injected into the system prompt: company
 * profile, key metrics of the current period and open insights. The LLM starts
 * every turn already knowing the shape of the business, which keeps most
 * questions to zero or one tool call.
 */
export class ContextBuilder {
  constructor(private readonly deps: ContextBuilderDeps) {}

  async build(ctx: ToolContext, options: { period?: { from: Date; to: Date } } = {}) {
    const period = options.period ?? currentMonthPeriod();

    const tenant = await this.deps.tenants.get(ctx, ctx.tenantId);

    const metricResults = await Promise.all(
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

    const insightPage = await this.deps.insights.list(ctx, {
      status: 'open',
      page: '1',
      pageSize: '5',
    });

    const metrics = metricResults.filter((result): result is MetricResult => result != null);

    const context: AiContext = {
      company: {
        id: tenant.id,
        name: tenant.name,
        currency: tenant.currency,
        timezone: tenant.timezone,
        today: new Date().toISOString().slice(0, 10),
      },
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      metrics: metrics.map((result) => ({
        key: result.key,
        value: result.value,
        change: result.comparison?.change,
        direction: result.comparison?.direction,
      })),
      insights: insightPage.items.map((insight) => ({
        id: insight.id,
        ruleKey: insight.ruleKey,
        type: insight.type,
        severity: insight.severity,
        title: insight.title,
      })),
      sources: metrics.map((result) => sourceFromMetric(result, 'context')),
    };

    return context;
  }
}
