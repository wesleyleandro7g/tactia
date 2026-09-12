import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import type { ToolDeps } from './shared';

const inputSchema = z.object({});

type BriefingToolData =
  | { available: false }
  | {
      available: true;
      id: string;
      period: { from: string; to: string };
      createdAt: string;
      model: string;
      content: string;
      facts: unknown;
    };

export function createGetLatestBriefingTool(deps: ToolDeps): Tool {
  return defineTool<typeof inputSchema, BriefingToolData>({
    name: 'get_latest_briefing',
    description:
      'Último briefing semanal gerado para a empresa (narrativa + fatos numéricos). ' +
      'Use quando o usuário pedir o resumo da semana ou mencionar o briefing.',
    inputSchema,
    async execute(ctx) {
      if (!deps.briefings) {
        return { data: { available: false as const }, sources: [] };
      }
      const briefing = await deps.briefings.latest(ctx);
      if (!briefing) {
        return { data: { available: false as const }, sources: [] };
      }
      return {
        data: {
          available: true as const,
          id: briefing.id,
          period: { from: briefing.periodFrom.toISOString(), to: briefing.periodTo.toISOString() },
          createdAt: briefing.createdAt.toISOString(),
          model: briefing.model,
          content: briefing.content,
          facts: briefing.facts,
        },
        sources: [
          {
            metric: 'briefing',
            period: { from: briefing.periodFrom.toISOString(), to: briefing.periodTo.toISOString() },
            tool: 'get_latest_briefing',
            label: 'Último briefing semanal',
          },
        ],
      };
    },
  });
}
