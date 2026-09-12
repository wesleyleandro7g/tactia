import { z } from 'zod';
import { METRIC_KEYS } from '@tactia/intelligence';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import type { ToolDeps } from './shared';

const inputSchema = z.object({
  metric: z.enum(METRIC_KEYS).optional().default('revenue').describe('Métrica da série.'),
  granularity: z
    .enum(['day', 'week', 'month'])
    .optional()
    .default('day')
    .describe('Granularidade dos pontos.'),
  window: z
    .number()
    .int()
    .min(4)
    .max(120)
    .optional()
    .describe('Quantidade de períodos para trás a partir de hoje. Padrão: 30 dias / 12 semanas / 12 meses.'),
  to: z.string().optional().describe('Fim exclusivo da janela (ISO). Padrão: agora.'),
});

const DEFAULT_WINDOW = { day: 30, week: 12, month: 12 } as const;

export function createGetTrendTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_trend',
    description:
      'Série temporal de uma métrica (dia/semana/mês) com média móvel, tendência (inclinação), ' +
      'variação entre metades da janela e pontos anômalos (z-score). Use para "como está evoluindo", ' +
      '"está melhorando ou piorando", "teve algum pico/queda".',
    inputSchema,
    async execute(ctx, input) {
      const to = input.to ? new Date(input.to) : new Date();
      if (Number.isNaN(to.getTime())) throw new Error('Data final inválida');
      const window = input.window ?? DEFAULT_WINDOW[input.granularity];
      const from = new Date(to);
      if (input.granularity === 'day') from.setUTCDate(from.getUTCDate() - window);
      else if (input.granularity === 'week') from.setUTCDate(from.getUTCDate() - window * 7);
      else from.setUTCMonth(from.getUTCMonth() - window);

      const trend = await deps.analytics.getTrend(ctx, {
        metric: input.metric,
        from,
        to,
        granularity: input.granularity,
      });

      return {
        data: {
          ...trend,
          window: { from: from.toISOString(), to: to.toISOString() },
        },
        sources: [
          {
            metric: input.metric,
            period: { from: from.toISOString(), to: to.toISOString() },
            value: trend.mean,
            tool: 'get_trend',
            label: `${input.metric} — média por ${input.granularity} na janela (${trend.points.length} pontos)`,
          },
        ],
      };
    },
  });
}
