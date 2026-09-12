import { z } from 'zod';
import { METRIC_KEYS } from '@tactia/intelligence';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodLabel, resolvePeriod, serializePeriod, sourceFromMetric, type ToolDeps } from './shared';

const periodSchema = z.object({
  from: z.string().describe('Data inicial (ISO 8601).'),
  to: z.string().describe('Data final exclusiva (ISO 8601).'),
});

const inputSchema = z.object({
  metric: z
    .enum(METRIC_KEYS)
    .describe('Métrica a comparar (revenue, sales_count, average_ticket, gross_margin, discount_total...).'),
  periodA: periodSchema.describe('Período principal (ex.: este mês).'),
  periodB: periodSchema.describe('Período de comparação (ex.: mês passado, mesmo mês do ano anterior).'),
  dimension: z
    .enum(['product', 'seller', 'category', 'customer', 'channel', 'region'])
    .optional()
    .describe('Quebra opcional: quem mais variou entre os períodos.'),
  limit: z.number().int().min(1).max(30).optional().default(10),
});

export function createComparePeriodsTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'compare_periods',
    description:
      'Compara uma métrica entre dois períodos quaisquer (ex.: este mês vs. mês passado, ' +
      'este ano vs. ano passado, semana atual vs. anterior), com quebra opcional por produto, ' +
      'vendedor, categoria, cliente, canal ou região. Use para perguntas "vs.", "comparado com", "em relação a".',
    inputSchema,
    async execute(ctx, input) {
      const periodA = resolvePeriod(input.periodA);
      const periodB = resolvePeriod(input.periodB);
      const data = await deps.analytics.comparePeriods(ctx, {
        metric: input.metric,
        periodA,
        periodB,
        dimension: input.dimension,
        limit: input.limit,
      });
      const { evidence, ...rest } = data;
      return {
        data: {
          ...rest,
          periodALabel: periodLabel(serializePeriod(periodA)),
          periodBLabel: periodLabel(serializePeriod(periodB)),
        },
        sources: evidence.map((result) => sourceFromMetric(result, 'compare_periods')),
      };
    },
  });
}
