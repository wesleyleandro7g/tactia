import { z } from 'zod';
import type { MetricResult } from '@tactia/intelligence';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodInputSchema, resolvePeriod, sourceFromMetric, type ToolDeps } from './shared';

const inputSchema = periodInputSchema;

export function createGetSalesHealthTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_sales_health',
    description:
      'Saúde das vendas: descontos, cancelamentos, reembolsos, pipeline pendente, ' +
      'vendas sem vendedor e breakdown por status. Use para "a taxa de cancelamento subiu?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const data = await deps.analytics.getSalesHealth(ctx, period);
      const metrics = data.metrics as Record<string, MetricResult>;
      const sources = Object.values(metrics).map((result) =>
        sourceFromMetric(result, 'get_sales_health'),
      );

      return { data, sources };
    },
  });
}
