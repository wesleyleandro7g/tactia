import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { type ToolDeps } from './shared';

const inputSchema = z.object({
  inactiveLeadDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .describe('Dias sem atividade para considerar lead inativo.')
    .optional()
    .default(7),
  hotLeadScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Score mínimo para lead quente.')
    .optional()
    .default(70),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

export function createGetPipelineTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_pipeline',
    description:
      'Funil de leads: contagem por status, conversão por origem, leads quentes parados ' +
      'e leads inativos. Use para "como está o funil?" ou "quais leads precisam de follow-up?".',
    inputSchema,
    async execute(ctx, input) {
      const data = await deps.analytics.getPipeline(ctx, input);
      return {
        data,
        sources: [
          {
            metric: 'pipeline',
            value: data.totals.leads,
            tool: 'get_pipeline',
            label: `${data.totals.leads} leads — win rate ${Math.round(data.totals.winRate * 100)}%`,
          },
        ],
      };
    },
  });
}
