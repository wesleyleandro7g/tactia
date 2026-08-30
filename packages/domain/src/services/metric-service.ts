import { z } from 'zod';
import type { MetricRepository } from '@tactia/database';
import { MetricEngine, METRIC_DEFINITIONS, METRIC_KEYS, type MetricKey } from '@tactia/intelligence';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertTenantContext } from '../authz';

export const metricPeriodSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const calculateMetricSchema = z.object({
  period: metricPeriodSchema,
  withComparison: z.boolean().optional().default(false),
  breakdown: z
    .object({
      dimension: z.enum(['product', 'seller', 'time']),
      granularity: z.enum(['day', 'week', 'month']).optional(),
    })
    .optional(),
});

export const listMetricsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  withComparison: z.string().optional(),
  breakdownDimension: z.enum(['product', 'seller', 'time']).optional(),
  breakdownGranularity: z.enum(['day', 'week', 'month']).optional(),
  keys: z.string().optional(), // comma-separated metric keys
});

export class MetricService {
  constructor(
    private readonly engine: MetricEngine,
    private readonly metrics: MetricRepository,
  ) {}

  /** List all available metric definitions */
  listDefinitions(ctx: RequestContext) {
    assertTenantContext(ctx);
    return this.engine.listDefinitions();
  }

  /** Calculate one metric */
  async calculate(ctx: RequestContext, key: string, raw: unknown) {
    assertTenantContext(ctx);

    if (!METRIC_KEYS.includes(key as MetricKey)) {
      throw new AppError(ErrorCode.NOT_FOUND, `Metric '${key}' not found`);
    }

    const input = calculateMetricSchema.parse(raw);

    return this.engine.calculate(key as MetricKey, {
      tenantId: ctx.tenantId,
      period: input.period,
      withComparison: input.withComparison,
      breakdown: input.breakdown,
    });
  }

  /** Calculate multiple (or all) metrics from query params */
  async calculateBulk(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);

    const parsed = listMetricsQuerySchema.parse(query);

    // Default period: current calendar month
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const period = {
      from: parsed.from ? new Date(parsed.from) : defaultFrom,
      to: parsed.to ? new Date(parsed.to) : defaultTo,
    };

    const withComparison = parsed.withComparison === 'true';

    const breakdown =
      parsed.breakdownDimension
        ? {
            dimension: parsed.breakdownDimension as 'product' | 'seller' | 'time',
            granularity: parsed.breakdownGranularity as 'day' | 'week' | 'month' | undefined,
          }
        : undefined;

    const requestedKeys: MetricKey[] = parsed.keys
      ? (parsed.keys
          .split(',')
          .map((k) => k.trim())
          .filter((k) => METRIC_KEYS.includes(k as MetricKey)) as MetricKey[])
      : [...METRIC_KEYS];

    const results = await Promise.all(
      requestedKeys.map((key) =>
        this.engine.calculate(key, {
          tenantId: ctx.tenantId,
          period,
          withComparison,
          breakdown,
        }),
      ),
    );

    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      metrics: results,
    };
  }

  /** Seed/upsert built-in metric definitions for a tenant */
  async seedDefinitions(ctx: RequestContext) {
    assertTenantContext(ctx);

    const updates = METRIC_KEYS.map((key) =>
      this.metrics.upsert({
        tenantId: ctx.tenantId,
        key,
        name: METRIC_DEFINITIONS[key].name,
        description: METRIC_DEFINITIONS[key].description,
        definition: { type: 'builtin', version: 'v0.1' },
      }),
    );

    return Promise.all(updates);
  }
}
