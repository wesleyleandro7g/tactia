import { z } from 'zod';
import { defineTool, type Tool } from '@tactia/ai';

const resultSchema = z.object({
  results: z.array(z.object({
    title: z.string().default('Página pública'),
    url: z.string().url(),
    content: z.string().default(''),
    published_date: z.string().nullish(),
  })).default([]),
});

const extractSchema = z.object({
  results: z.array(z.object({ url: z.string().url(), raw_content: z.string().nullish() })).default([]),
});

function publicQuery(query: string): string {
  return query
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '')
    .replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, '')
    .replace(/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b/g, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '')
    .replace(/R\$\s*[\d.,]+/gi, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, '')
    .replace(/\b\d{8,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function publishedDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function tavily(path: 'search' | 'extract', key: string, body: unknown) {
  const response = await fetch(`https://api.tavily.com/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8500),
  });
  if (!response.ok) throw new Error(`Pesquisa pública indisponível (${response.status})`);
  return response.json() as Promise<unknown>;
}

/** Search public pages only. Authentication-bound systems keep using browser profiles. */
export function createPublicWebSearchTool(apiKey: string): Tool {
  return defineTool({
    name: 'search_public_web',
    recoverySafe: true,
    description: 'Pesquisa a web pública para contexto atual de mercado, setor, concorrência e regulamentação. Retorna páginas com URL e data. Não use para consultar sistemas internos nem para obter dados da empresa.',
    inputSchema: z.object({ query: z.string().trim().min(5).max(350) }).strict(),
    async execute(_ctx, input) {
      const query = publicQuery(input.query);
      if (query.length < 5) throw new Error('A consulta pública precisa de termos não confidenciais');
      const found = resultSchema.parse(await tavily('search', apiKey, {
        query, topic: /\b(not[ií]cias?|hoje|esta semana|atualiza[cç][aã]o)\b/i.test(query) ? 'news' : 'general',
        search_depth: 'basic', max_results: 5,
        include_answer: false, include_raw_content: false, include_published_date: true,
      }));
      const results = found.results.filter((item) => item.url.startsWith('https://')).slice(0, 5);
      let extracts = new Map<string, string>();
      if (results.length) {
        try {
          const detail = extractSchema.parse(await tavily('extract', apiKey, {
            urls: results.slice(0, 2).map((item) => item.url), extract_depth: 'basic',
          }));
          extracts = new Map(detail.results.map((item) => [item.url, (item.raw_content ?? '').slice(0, 3500)]));
        } catch {
          // Search snippets remain useful if extraction fails.
        }
      }
      const pages = results.map((item) => ({
        title: item.title.slice(0, 180),
        url: item.url,
        publishedAt: publishedDate(item.published_date),
        accessedAt: new Date().toISOString(),
        content: (extracts.get(item.url) || item.content).slice(0, 1200),
      }));
      return {
        data: { query, pages },
        sources: pages.map((page) => ({
          metric: 'external_web', tool: 'search_public_web', label: page.title,
          url: page.url, publishedAt: page.publishedAt, accessedAt: page.accessedAt,
          excerpt: page.content,
        })),
      };
    },
  });
}
