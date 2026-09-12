import { z } from 'zod';
import { defineTool } from '../tool-registry';
import { sanitizeInjection } from '../untrusted';
import type { MessageSource, Tool, ToolResult } from '../types';
import type { ToolDeps } from './shared';

function excerpt(text: string, max = 240): string {
  const trimmed = sanitizeInjection(text.trim());
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function createSearchBusinessFactsTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'search_business_facts',
    description:
      'Busca fatos/eventos/preferências do negócio por similaridade com a pergunta. ' +
      'Use quando precisar de contexto qualitativo ("temos promoção?", "fulano saiu?"). Não calcula métrica.',
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).optional().default(8),
      kind: z.enum(['fact', 'event', 'preference']).optional(),
    }),
    async execute(ctx, input) {
      if (!deps.facts) {
        return { data: { query: input.query, mode: 'keyword' as const, matches: [] }, sources: [] };
      }
      const result = await deps.facts.searchSemantic(ctx, {
        query: input.query,
        limit: input.limit,
        kinds: input.kind ? [input.kind] : undefined,
      });
      const matches = result.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        text: item.text,
        score: 'score' in item ? (item.score as number | undefined) : undefined,
        entityType: item.entityType,
        entityId: item.entityId,
        validFrom: item.validFrom?.toISOString() ?? null,
        validTo: item.validTo?.toISOString() ?? null,
      }));
      const sources: MessageSource[] = matches.slice(0, 5).map((item) => ({
        metric: 'business_facts',
        tool: 'search_business_facts',
        refId: item.id,
        excerpt: excerpt(item.text),
        label: `[${item.kind}] ${item.text.slice(0, 80)}`,
      }));
      return {
        data: { query: input.query, mode: result.mode, matches },
        sources,
      };
    },
  });
}

export function createSearchEpisodesTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'search_episodes',
    description:
      'Busca decisões e resultados de ações já aprovadas, rejeitadas ou executadas nesta empresa. ' +
      'Use para "já tentamos desconto?", "o que decidimos sobre o cliente X?".',
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).optional().default(8),
      outcome: z.enum(['approved', 'rejected', 'executed', 'failed', 'cancelled']).optional(),
    }),
    async execute(ctx, input) {
      if (!deps.episodes) {
        return { data: { query: input.query, mode: 'keyword' as const, matches: [] }, sources: [] };
      }
      const result = await deps.episodes.searchSemantic(ctx, {
        query: input.query,
        limit: input.limit,
        outcome: input.outcome,
      });
      const matches = result.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        outcome: item.outcome,
        text: item.text,
        score: 'score' in item ? (item.score as number | undefined) : undefined,
        occurredAt: item.occurredAt.toISOString(),
        actionExecutionId: item.actionExecutionId,
      }));
      const sources: MessageSource[] = matches.slice(0, 5).map((item) => ({
        metric: 'episodes',
        tool: 'search_episodes',
        refId: item.id,
        excerpt: excerpt(item.text),
        label: `${item.kind}/${item.outcome}`,
      }));
      return {
        data: { query: input.query, mode: result.mode, matches },
        sources,
      };
    },
  });
}

export function createListPlaybooksTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'list_playbooks',
    description:
      'Lista playbooks (procedimentos) da empresa. São só leitura: narre os passos; nunca afirme que executou.',
    inputSchema: z.object({
      enabled: z.boolean().optional(),
    }),
    async execute(ctx, input) {
      if (!deps.playbooks) return { data: { items: [] }, sources: [] };
      const data = await deps.playbooks.list(ctx, { enabled: input.enabled ?? true });
      return {
        data: {
          items: data.items.map((item) => ({
            id: item.id,
            slug: item.slug,
            title: item.title,
            trigger: item.trigger,
          })),
        },
        sources: [{ metric: 'playbooks', tool: 'list_playbooks', label: `${data.items.length} playbooks` }],
      };
    },
  });
}

export function createGetPlaybookTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_playbook',
    description:
      'Detalhe de um playbook por slug ou id, incluindo os passos. Narre os passos; se couber providência, use propose_action. Nunca execute o playbook.',
    inputSchema: z
      .object({
        slug: z.string().min(2).max(64).optional(),
        id: z.string().uuid().optional(),
      })
      .refine((value) => Boolean(value.slug || value.id), {
        message: 'Informe slug ou id',
      }),
    async execute(ctx, input): Promise<ToolResult<{ found: boolean; playbook?: unknown }>> {
      if (!deps.playbooks) return { data: { found: false }, sources: [] };
      const playbook = await deps.playbooks.getBySlugOrId(ctx, {
        slug: input.slug,
        id: input.id,
      });
      if (!playbook) return { data: { found: false }, sources: [] };
      const serialized = deps.playbooks.serialize(playbook);
      return {
        data: { found: true, playbook: serialized },
        sources: [
          {
            metric: 'playbooks',
            tool: 'get_playbook',
            refId: serialized.id,
            excerpt: excerpt(serialized.trigger),
            label: serialized.title,
          },
        ],
      };
    },
  });
}
