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
    .describe('Quantidade de produtos no ranking.')
    .optional()
    .default(10),
});

/**
 * get_products — ranking de produtos por receita no período.
 */
export function createGetProductsTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_products',
    description:
      'Retorna o ranking de produtos por receita no período (receita agregada por item de ' +
      'venda) e o total de produtos cadastrados. Use para "qual foi nosso melhor produto?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);

      const revenue = (await deps.metrics.calculate(ctx, 'revenue', {
        period,
        breakdown: { dimension: 'product' },
      })) as MetricResult;

      const catalog = await deps.products.list(ctx, { page: '1', pageSize: '1' });

      const ranking = (revenue.breakdown?.items ?? []).slice(0, input.limit).map((item, index) => ({
        position: index + 1,
        productId: item.key,
        name: item.label ?? item.key,
        revenue: item.value,
      }));

      return {
        data: {
          period: revenue.period,
          totalRevenue: revenue.value,
          totalProducts: catalog.total,
          ranking,
        },
        sources: [sourceFromMetric(revenue, 'get_products')],
      };
    },
  });
}
