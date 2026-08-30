import { z } from 'zod';
import type { MetricResult } from '@tactia/intelligence';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodInputSchema, resolvePeriod, sourceFromMetric, type ToolDeps } from './shared';

const inputSchema = periodInputSchema.extend({
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .describe('Quantidade de vendedores no ranking.')
    .optional()
    .default(10),
});

/**
 * get_sellers — ranking de vendedores por receita no período.
 */
export function createGetSellersTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_sellers',
    description:
      'Retorna o ranking de vendedores por receita no período, a receita média por vendedor ' +
      'e o total de vendedores cadastrados. Use para "quem mais vendeu?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);

      const revenue = (await deps.metrics.calculate(ctx, 'revenue', {
        period,
        breakdown: { dimension: 'seller' },
      })) as MetricResult;

      const team = await deps.sellers.list(ctx, { page: '1', pageSize: '1' });

      const items = revenue.breakdown?.items ?? [];
      const ranking = items.slice(0, input.limit).map((item, index) => ({
        position: index + 1,
        sellerId: item.key,
        name: item.label ?? item.key,
        revenue: item.value,
      }));
      const averageRevenue =
        items.length > 0 ? items.reduce((sum, item) => sum + item.value, 0) / items.length : 0;

      return {
        data: {
          period: revenue.period,
          totalRevenue: revenue.value,
          totalSellers: team.total,
          averageRevenuePerSeller: averageRevenue,
          ranking,
        },
        sources: [sourceFromMetric(revenue, 'get_sellers')],
      };
    },
  });
}
