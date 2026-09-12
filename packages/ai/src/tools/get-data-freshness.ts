import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { type ToolDeps } from './shared';

const inputSchema = z.object({
  staleHours: z
    .number()
    .int()
    .min(1)
    .max(720)
    .describe('Horas sem sync para considerar fonte desatualizada.')
    .optional()
    .default(48),
});

export function createGetDataFreshnessTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_data_freshness',
    description:
      'Mostra quando cada fonte de dados foi sincronizada, falhas recentes e qualidade. ' +
      'Use para "os dados estão atualizados?" ou antes de confiar em números antigos.',
    inputSchema,
    async execute(ctx, input) {
      const data = await deps.analytics.getDataFreshness(ctx, input.staleHours);
      return {
        data,
        sources: [
          {
            metric: 'data_freshness',
            value: data.staleCount,
            tool: 'get_data_freshness',
            label: `${data.staleCount} fonte(s) desatualizada(s) de ${data.sources.length}`,
          },
        ],
      };
    },
  });
}
