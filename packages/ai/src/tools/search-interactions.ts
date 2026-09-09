import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { MessageSource, Tool } from '../types';
import {
  periodInputSchema,
  resolvePeriod,
  serializePeriod,
  type ToolDeps,
} from './shared';

const inputSchema = periodInputSchema.extend({
  query: z.string().min(1).max(500).describe('Pergunta ou tema a buscar nas interações.'),
  customerId: z.string().uuid().describe('Restringe a busca a um cliente.').optional(),
  intent: z
    .enum(['complaint', 'praise', 'question', 'other'])
    .describe('Filtra pelo intent classificado.')
    .optional(),
  channel: z.enum(['whatsapp', 'email', 'note', 'other']).optional(),
  limit: z.number().int().min(1).max(30).optional().default(8),
});

function excerpt(body: string, max = 240): string {
  const trimmed = body.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function createSearchInteractionsTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'search_interactions',
    description:
      'Busca mensagens, e-mails e notas do período. Usa busca semântica quando o ' +
      'embedding está disponível; caso contrário, filtra por texto/intent. Use para ' +
      '"o que o cliente falou sobre atraso?" ou "menciona boleto".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const serialized = serializePeriod(period);

      type Hit = {
        id: string;
        occurredAt: string;
        channel: string;
        intent: string | null;
        customerId: string | null;
        excerpt: string;
        score?: number;
      };

      let items: Hit[] = [];
      let mode: 'semantic' | 'keyword' = 'keyword';

      if (deps.embedder) {
        try {
          const [embedding] = await deps.embedder.embed([input.query]);
          if (embedding) {
            const hits = await deps.interactions.searchSemantic(ctx, {
              embedding,
              from: period.from,
              to: period.to,
              customerId: input.customerId,
              intent: input.intent,
              limit: input.limit,
            });
            items = hits.map((hit) => ({
              id: hit.id,
              occurredAt: hit.occurredAt.toISOString(),
              channel: hit.channel,
              intent: hit.intent,
              customerId: hit.customerId,
              excerpt: excerpt(hit.body),
              score: hit.score,
            }));
            mode = 'semantic';
          }
        } catch {
          mode = 'keyword';
        }
      }

      if (mode === 'keyword' && items.length === 0) {
        const list = await deps.interactions.list(ctx, {
          page: '1',
          pageSize: String(input.limit),
          search: input.query,
          from: period.from.toISOString(),
          to: period.to.toISOString(),
          ...(input.customerId ? { customerId: input.customerId } : {}),
          ...(input.intent ? { intent: input.intent } : {}),
          ...(input.channel ? { channel: input.channel } : {}),
        });
        items = list.items.map((interaction) => ({
          id: interaction.id,
          occurredAt: interaction.occurredAt.toISOString(),
          channel: interaction.channel,
          intent: interaction.intent,
          customerId: interaction.customerId,
          excerpt: excerpt(interaction.body),
        }));
      }

      const sources: MessageSource[] = [
        {
          metric: 'interactions',
          period: serialized,
          value: items.length,
          tool: 'search_interactions',
          label: `${items.length} interação(ões) para "${input.query}"`,
        },
        ...items.slice(0, 5).map((item) => ({
          metric: 'interactions',
          period: serialized,
          tool: 'search_interactions',
          refId: item.id,
          excerpt: item.excerpt,
          label: item.channel,
        })),
      ];

      return {
        data: { query: input.query, mode, period: serialized, matches: items },
        sources,
      };
    },
  });
}
