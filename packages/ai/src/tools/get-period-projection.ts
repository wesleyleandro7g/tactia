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

      return {
        data,
        sources: [sourceFromMetric(revenueMetric, 'get_period_projection')],
      };
    },
  });
}
