import { z } from 'zod';
import type { MetricResult } from '@tactia/intelligence';
import type {
  AnalyticsService,
  BriefingService,
  BusinessFactService,
  CatalogEmbeddingService,
  CustomerService,
  DataCatalogService,
  EpisodeService,
  InsightService,
  InteractionService,
  KnowledgeDocumentService,
  MetricService,
  PlaybookService,
  ProductService,
  RecommendationService,
  SaleService,
  SellerService,
  StructuredQueryService,
} from '@tactia/domain';
import type { EmbeddingAdapter } from '../embeddings/types';
import type { MessageSource } from '../types';

/**
 * Domain services the tools delegate to. Tools never touch Prisma or SQL — all
 * data access goes through the same services used by the REST API, so tenant
 * isolation and authorization are enforced exactly once (spec §41, §43).
 */
export type ToolDeps = {
  metrics: MetricService;
  analytics: AnalyticsService;
  customers: CustomerService;
  products: ProductService;
  sellers: SellerService;
  sales: SaleService;
  insights: InsightService;
  briefings?: BriefingService;
  facts?: BusinessFactService;
  episodes?: EpisodeService;
  playbooks?: PlaybookService;
  recommendations: RecommendationService;
  interactions: InteractionService;
  embedder?: EmbeddingAdapter | null;
  documents?: KnowledgeDocumentService;
  catalog?: CatalogEmbeddingService;
  dataCatalog?: DataCatalogService;
  structuredQuery?: StructuredQueryService;
};

/** Optional ISO period accepted by every data tool. */
export const periodInputSchema = z.object({
  from: z
    .string()
    .describe('Data inicial (ISO 8601, ex: 2026-08-01). Padrão: início do mês atual.')
    .optional(),
  to: z
    .string()
    .describe('Data final exclusiva (ISO 8601, ex: 2026-09-01). Padrão: início do próximo mês.')
    .optional(),
});

export type PeriodInput = z.infer<typeof periodInputSchema>;

export type ResolvedPeriod = { from: Date; to: Date };

/** Current calendar month in the server timezone. */
export function currentMonthPeriod(now = new Date()): ResolvedPeriod {
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

export function resolvePeriod(input: PeriodInput, now = new Date()): ResolvedPeriod {
  const fallback = currentMonthPeriod(now);
  const from = input.from ? new Date(input.from) : fallback.from;
  const to = input.to ? new Date(input.to) : fallback.to;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['period'],
        message: 'Datas inválidas: use o formato ISO 8601 (YYYY-MM-DD).',
      },
    ]);
  }
  if (from >= to) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['period'],
        message: 'A data inicial deve ser anterior à data final.',
      },
    ]);
  }
  return { from, to };
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export function periodLabel(period: { from: string; to: string }): string {
  return `${formatDate(period.from)} a ${formatDate(period.to)}`;
}

/** Turns a MetricResult into citable evidence (spec §43). */
export function sourceFromMetric(result: MetricResult, tool: string): MessageSource {
  const rate = ['sales_growth', 'revenue_growth', 'cancellation_rate', 'refund_rate'].includes(result.key);
  const claim = (value: number, period: MetricResult['period']): NonNullable<MessageSource['numericEvidence']>[number] => ({
    value: rate ? value * 100 : value,
    unit: rate ? 'percent' : 'number',
    kind: 'observed',
    metric: result.key,
    period,
  });
  return {
    metric: result.key,
    period: result.period,
    value: result.value,
    tool,
    label: `${result.key} — ${periodLabel(result.period)}`,
    numericEvidence: [
      claim(result.value, result.period),
      ...(result.comparison
        ? [
            claim(result.comparison.value, result.comparison.period),
            {
              value: result.comparison.change * 100,
              unit: 'percent' as const,
              kind: 'observed' as const,
              metric: result.key,
              period: result.period,
            },
          ]
        : []),
      ...(result.breakdown?.items.map((item) => claim(item.value, result.period)) ?? []),
    ],
  };
}

export function serializePeriod(period: ResolvedPeriod) {
  return { from: period.from.toISOString(), to: period.to.toISOString() };
}
