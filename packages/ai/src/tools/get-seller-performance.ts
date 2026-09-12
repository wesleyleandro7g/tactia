import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodInputSchema, resolvePeriod, sourceFromMetric, type ToolDeps } from './shared';

const inputSchema = periodInputSchema.extend({
  limit: z.number().int().min(1).max(50).optional().default(10),
});

export function createGetSellerPerformanceTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_seller_performance',
    description:
      'Desempenho detalhado de vendedores: receita, ticket, desconto, clientes distintos, ' +
      'atividades registradas e variação vs. período anterior. Use para "quem dá mais desconto?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const data = await deps.analytics.getSellerPerformance(ctx, period, input.limit);
      const revenue = await deps.metrics.calculate(ctx, 'revenue', {
        period,
        breakdown: { dimension: 'seller' },
      });

      return {
        data,
        sources: [sourceFromMetric(revenue, 'get_seller_performance')],
      };
    },
  });
}
