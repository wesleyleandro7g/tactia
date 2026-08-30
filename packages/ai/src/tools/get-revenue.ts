import { z } from 'zod';
import type { MetricResult } from '@tactia/intelligence';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodInputSchema, resolvePeriod, sourceFromMetric, type ToolDeps } from './shared';

const inputSchema = periodInputSchema.extend({
  compareWithPreviousPeriod: z
    .boolean()
    .describe('Compara com o período anterior de mesma duração.')
    .optional()
    .default(true),
  groupBy: z
    .enum(['none', 'day', 'week', 'month', 'product', 'seller'])
    .describe('Abre a receita por tempo, produto ou vendedor.')
    .optional()
    .default('none'),
});

type Input = z.infer<typeof inputSchema>;

function breakdownFor(groupBy: Input['groupBy']) {
  if (groupBy === 'none') return undefined;
  if (groupBy === 'product') return { dimension: 'product' as const };
  if (groupBy === 'seller') return { dimension: 'seller' as const };
  return { dimension: 'time' as const, granularity: groupBy };
}

/**
 * get_revenue — receita confirmada no período, com comparação e breakdown.
 * Delegates to MetricService (deterministic engine, spec §3.4).
 */
export function createGetRevenueTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_revenue',
    description:
      'Retorna a receita (soma das vendas confirmadas) de um período, com comparação ' +
      'contra o período anterior e opção de abrir por dia/semana/mês, produto ou vendedor. ' +
      'Use para perguntas como "quanto vendemos este mês?" ou "a receita caiu?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);

      const revenue = (await deps.metrics.calculate(ctx, 'revenue', {
        period,
        withComparison: input.compareWithPreviousPeriod,
        breakdown: breakdownFor(input.groupBy),
      })) as MetricResult;

      return {
        data: {
          metric: revenue.key,
          value: revenue.value,
          period: revenue.period,
          comparison: revenue.comparison,
          breakdown: revenue.breakdown,
        },
        sources: [sourceFromMetric(revenue, 'get_revenue')],
      };
    },
  });
}
