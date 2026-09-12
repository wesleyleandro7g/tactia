import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { MessageSource, Tool } from '../types';
import {
  periodInputSchema,
  resolvePeriod,
  serializePeriod,
  sourceFromMetric,
  type ToolDeps,
} from './shared';

const inputSchema = periodInputSchema.extend({
  limit: z.number().int().min(1).max(50).optional().default(10),
});

export function createGetProductPerformanceTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_product_performance',
    description:
      'Desempenho de produtos: receita, unidades, desconto, margem bruta, mix por categoria ' +
      'e produtos ativos sem venda. Use para "qual produto dá mais margem?" ou "o que parou de vender?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const data = await deps.analytics.getProductPerformance(ctx, period, input.limit);
      const serialized = serializePeriod(period);

      const [margin, units] = await Promise.all([
        deps.metrics.calculate(ctx, 'gross_margin', { period, withComparison: true }),
        deps.metrics.calculate(ctx, 'units_sold', { period, withComparison: true }),
      ]);

      const sources: MessageSource[] = [
        sourceFromMetric(margin, 'get_product_performance'),
        sourceFromMetric(units, 'get_product_performance'),
        {
          metric: 'unsold_active_products',
          period: serialized,
          value: data.unsoldActiveProducts,
          tool: 'get_product_performance',
          label: `${data.unsoldActiveProducts} produto(s) ativo(s) sem venda no período`,
        },
      ];

      return { data, sources };
    },
  });
}
