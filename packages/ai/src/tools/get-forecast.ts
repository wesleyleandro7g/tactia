import { z } from 'zod';
import { METRIC_KEYS } from '@tactia/intelligence';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import type { ToolDeps } from './shared';

const inputSchema = z.object({
  metric: z.enum(METRIC_KEYS).optional().default('revenue').describe('Métrica a projetar.'),
  horizonDays: z
    .number()
    .int()
    .min(1)
    .max(120)
    .optional()
    .default(30)
    .describe('Quantos dias à frente projetar (padrão 30).'),
});

export function createGetForecastTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_forecast',
    description:
      'Projeção diária de uma métrica para os próximos N dias com faixa P10/P90, usando ' +
      'sazonalidade por dia da semana e tendência (Holt) sobre o histórico diário. ' +
      'Use para "quanto devemos vender nos próximos 30 dias", "qual a expectativa para o mês que vem". ' +
      'Para "vamos fechar o mês em quanto?" prefira get_period_projection.',
    inputSchema,
    async execute(ctx, input) {
      const forecast = await deps.analytics.getForecast(ctx, {
        metric: input.metric,
        horizonDays: input.horizonDays,
      });

      return {
        data: {
          ...forecast,
          // Keep the payload small: the LLM needs totals and the first weeks, not 120 rows.
          points: forecast.points.slice(0, 35),
          truncatedPoints: Math.max(0, forecast.points.length - 35),
        },
        sources: [
          {
            metric: input.metric,
            period: { from: forecast.from, to: forecast.to },
            value: forecast.total.expected,
            tool: 'get_forecast',
            label: `${input.metric} — projeção ${forecast.method} para ${input.horizonDays} dias (P10 ${forecast.total.low} · P90 ${forecast.total.high}; histórico ${forecast.historyDays} dias, fonte ${forecast.source})`,
            numericEvidence: [
              ...[forecast.total.expected, forecast.total.low, forecast.total.high]
                .map((value) => ({ value, unit: 'number' as const, kind: 'estimated' as const, metric: input.metric, period: { from: forecast.from, to: forecast.to } })),
              { value: forecast.previous.value, unit: 'number' as const, kind: 'observed' as const, metric: input.metric },
              ...(forecast.previous.change != null ? [{ value: forecast.previous.change * 100, unit: 'percent' as const, kind: 'estimated' as const, metric: input.metric }] : []),
            ],
          },
        ],
      };
    },
  });
}
