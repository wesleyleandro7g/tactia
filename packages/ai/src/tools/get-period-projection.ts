import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodInputSchema, resolvePeriod, sourceFromMetric, type ToolDeps } from './shared';

const inputSchema = periodInputSchema;

export function createGetPeriodProjectionTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_period_projection',
    description:
      'Projeção de fechamento do período: receita/vendas até agora, projeção sazonal (dia da semana + ' +
      'tendência Holt) com faixa P10/P90 para fechar o período, run-rate linear e gap vs. período anterior. ' +
      'Use para "vamos bater o mês passado?", "em quanto fechamos o mês?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const data = await deps.analytics.getPeriodProjection(ctx, period);
      const revenueMetric = await deps.metrics.calculate(ctx, 'revenue', {
        period,
        withComparison: true,
      });

      const revenueSource = sourceFromMetric(revenueMetric, 'get_period_projection');
      return {
        data,
        sources: [
          {
            ...revenueSource,
            numericEvidence: [
              ...(revenueSource.numericEvidence ?? []),
              ...[data.projection.revenue.expected, data.projection.revenue.low, data.projection.revenue.high, data.projection.revenueLinear, data.projection.revenueGapVsPrevious].map((value) => ({
                value, unit: 'number' as const, kind: 'estimated' as const, metric: 'revenue', period: data.period,
              })),
              { value: data.previousPeriod.revenue, unit: 'number', kind: 'observed', metric: 'revenue' },
            ],
          },
          {
            metric: 'sales_count',
            period: data.period,
            value: data.current.salesCount,
            tool: 'get_period_projection',
            numericEvidence: [
              { value: data.current.salesCount, unit: 'number', kind: 'observed', metric: 'sales_count', period: data.period },
              { value: data.previousPeriod.salesCount, unit: 'number', kind: 'observed', metric: 'sales_count' },
              ...[data.projection.salesCount.expected, data.projection.salesCount.low, data.projection.salesCount.high, data.projection.salesLinear, data.projection.salesGapVsPrevious].map((value) => ({
                value, unit: 'number' as const, kind: 'estimated' as const, metric: 'sales_count', period: data.period,
              })),
            ],
          },
        ],
      };
    },
  });
}
