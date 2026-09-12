import { z } from 'zod';
import { CHUNK_SEARCH_LIMIT } from '@tactia/domain';
import { defineTool } from '../tool-registry';
import { sanitizeInjection, wrapUntrusted } from '../untrusted';
import type { MessageSource, Tool } from '../types';
import type { ToolDeps } from './shared';

function excerpt(text: string, max = 240): string {
  const trimmed = sanitizeInjection(text.trim());
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function createSearchDocumentsTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'search_documents',
    description:
      'Busca políticas, contratos e textos internos já indexados. ' +
      'NÃO use para receita, ticket, estoque, metas ou qualquer métrica — ' +
      'essas vêm das outras ferramentas. Use para "qual nossa política de ' +
      'troca?", "o contrato fala de SLA?".',
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).optional().default(CHUNK_SEARCH_LIMIT),
    }),
    async execute(ctx, input) {
      if (!deps.documents) {
        return { data: { query: input.query, mode: 'keyword' as const, matches: [] }, sources: [] };
      }

      let mode: 'semantic' | 'keyword' = 'keyword';
      let hits: Array<{
        id: string;
        documentId: string;
        documentTitle: string;
        heading: string | null;
        page: number | null;
        text: string;
        score?: number;
      }> = [];

      if (deps.embedder) {
        try {
          const [embedding] = await deps.embedder.embed([input.query]);
          if (embedding) {
            hits = await deps.documents.search(ctx, { embedding, limit: input.limit });
            mode = 'semantic';
          }
        } catch {
          mode = 'keyword';
        }
      }

      if (mode === 'keyword' || hits.length === 0) {
        const keywordHits = await deps.documents.search(ctx, {
          query: input.query,
          limit: input.limit,
        });
        if (keywordHits.length > 0) {
          hits = keywordHits;
          mode = 'keyword';
        }
      }

      const matches = hits.map((hit) => ({
        documentId: hit.documentId,
        title: hit.documentTitle,
        heading: hit.heading,
        page: hit.page,
        excerpt: wrapUntrusted(excerpt(hit.text), 'document'),
        score: hit.score,
      }));

      const sources: MessageSource[] = matches.map((match, index) => ({
        metric: 'documents',
        tool: 'search_documents',
        refId: hits[index]?.id,
        excerpt: excerpt(hits[index]?.text ?? ''),
        label: match.title,
      }));

      return {
        data: { mode, query: input.query, matches },
        sources,
      };
    },
  });
}
