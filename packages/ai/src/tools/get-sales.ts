import { z } from 'zod';
import type { MetricResult } from '@tactia/intelligence';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodInputSchema, resolvePeriod, sourceFromMetric, type ToolDeps } from './shared';

const inputSchema = periodInputSchema.extend({
  groupBy: z
    .enum(['none', 'day', 'week', 'month'])
    .describe('Abre as vendas por dia, semana ou mês.')
    .optional()
    .default('none'),
  recentSalesLimit: z
    .number()
    .int()
    .min(0)
    .max(20)
    .describe('Quantidade de vendas recentes a listar (0 = nenhuma).')
    .optional()
    .default(0),
});

/**
 * get_sales — volume de vendas, ticket médio e (opcionalmente) vendas recentes.
 */
export function createGetSalesTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_sales',
    description:
      'Retorna o número de vendas confirmadas, o ticket médio e o crescimento de vendas ' +
      'do período, com opção de série temporal e de listar vendas recentes. ' +
      'Use para "quantas vendas fizemos?" ou "qual o ticket médio?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const breakdown =
        input.groupBy === 'none'
          ? undefined
          : { dimension: 'time' as const, granularity: input.groupBy };

      const [salesCount, averageTicket, salesGrowth] = (await Promise.all([
        deps.metrics.calculate(ctx, 'sales_count', {
          period,
          withComparison: true,
          breakdown,
        }),
        deps.metrics.calculate(ctx, 'average_ticket', { period, withComparison: true }),
        deps.metrics.calculate(ctx, 'sales_growth', { period }),
      ])) as MetricResult[];

      const recentSales =
        input.recentSalesLimit > 0
          ? await deps.sales.list(ctx, {
              page: '1',
              pageSize: String(input.recentSalesLimit),
              status: 'confirmed',
            })
          : null;

      return {
        data: {
          salesCount: {
            value: salesCount?.value,
            period: salesCount?.period,
            comparison: salesCount?.comparison,
            breakdown: salesCount?.breakdown,
          },
          averageTicket: {
            value: averageTicket?.value,
            comparison: averageTicket?.comparison,
          },
          salesGrowth: { value: salesGrowth?.value },
          recentSales: recentSales?.items ?? undefined,
        },
        sources: [salesCount, averageTicket, salesGrowth]
          .filter((result): result is MetricResult => result != null)
          .map((result) => sourceFromMetric(result, 'get_sales')),
      };
    },
  });
}
