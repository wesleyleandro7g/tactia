import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodInputSchema, resolvePeriod, serializePeriod, type ToolDeps } from './shared';

const inputSchema = periodInputSchema.extend({
  limit: z.number().int().min(1).max(50).optional().default(10),
});

export function createGetCustomerSegmentsTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_customer_segments',
    description:
      'Segmentação de clientes: risco de churn, concentração de receita (Pareto), ' +
      'clientes ativos/novos/recorrentes no período. Use para "quem está prestes a churnar?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const data = await deps.analytics.getCustomerSegments(ctx, period, input.limit);
      const serialized = serializePeriod(period);

      return {
        data,
        sources: [
          {
            metric: 'customer_segments',
            period: serialized,
            value: data.totals.churnRisk,
            tool: 'get_customer_segments',
            label: `${data.totals.churnRisk} cliente(s) em risco de churn`,
          },
          {
            metric: 'customer_count',
            period: serialized,
            value: data.totals.activeInPeriod,
            tool: 'get_customer_segments',
            label: `${data.totals.activeInPeriod} cliente(s) ativos no período`,
          },
        ],
      };
    },
  });
}
