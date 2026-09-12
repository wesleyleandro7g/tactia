import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodInputSchema, resolvePeriod, serializePeriod, type ToolDeps } from './shared';

const inputSchema = periodInputSchema.extend({
  limit: z.number().int().min(1).max(30).optional().default(10),
});

export function createGetProductAffinityTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_product_affinity',
    description:
      'Cross-sell: pares de produtos comprados juntos no período. ' +
      'Use para "quem compra X também compra o quê?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const data = await deps.analytics.getProductAffinity(ctx, period, input.limit);
      const serialized = serializePeriod(period);

      return {
        data,
        sources: [
          {
            metric: 'product_affinity',
            period: serialized,
            value: data.pairs.length,
            tool: 'get_product_affinity',
            label: `${data.pairs.length} par(es) de produtos co-ocorrentes`,
          },
        ],
      };
    },
  });
}
