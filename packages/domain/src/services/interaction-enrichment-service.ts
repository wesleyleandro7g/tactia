import type { InteractionIntent, InteractionRepository, ProductRepository } from '@tactia/database';
import { logger } from '@tactia/shared';
import type {
  ClassifiedInteraction,
  ClassifierProduct,
  InteractionClassifier,
  InteractionEmbedder,
} from '../ports/interaction-enrichment';

const BATCH_SIZE = 32;
const MAX_PRODUCTS_FOR_CLASSIFIER = 150;

export type InteractionEnrichmentDeps = {
  interactions: InteractionRepository;
  classifier?: InteractionClassifier | null;
  embedder?: InteractionEmbedder | null;
  /** When provided, product mentions are resolved to product ids. */
  products?: ProductRepository | null;
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Resolves a product mention (classifier output) or a raw message body to a
 * product id by name match — exact first, then containment.
 */
export function resolveProductMention(
  mention: string | null | undefined,
  body: string,
  products: ClassifierProduct[],
): string | null {
  if (products.length === 0) return null;
  const normalizedMention = mention ? normalize(mention) : null;
  if (normalizedMention) {
    const exact = products.find((p) => normalize(p.name) === normalizedMention);
    if (exact) return exact.id;
    const partial = products.find(
      (p) => normalize(p.name).includes(normalizedMention) || normalizedMention.includes(normalize(p.name)),
    );
    if (partial) return partial.id;
  }
  const normalizedBody = normalize(body);
  // Longest product name first so "Plano Pro Anual" wins over "Plano Pro".
  const byLength = [...products].sort((a, b) => b.name.length - a.name.length);
  const inBody = byLength.find((p) => p.name.length >= 4 && normalizedBody.includes(normalize(p.name)));
  return inBody?.id ?? null;
}

/**
 * Classifies and embeds pending interactions after sync/create.
 * Provider failures are logged and never thrown to the caller.
 */
export class InteractionEnrichmentService {
  constructor(private readonly deps: InteractionEnrichmentDeps) {}

  private async loadProducts(tenantId: string): Promise<ClassifierProduct[]> {
    if (!this.deps.products) return [];
    try {
      const result = await this.deps.products.list({
        tenantId,
        skip: 0,
        take: MAX_PRODUCTS_FOR_CLASSIFIER,
      });
      return result.items.map((product) => ({ id: product.id, name: product.name }));
    } catch (error) {
      logger.warn(
        {
          tenant_id: tenantId,
          operation: 'interaction_enrich_products',
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to load products for classifier',
      );
      return [];
    }
  }

  async enrichPending(input: { tenantId: string; dataSourceId?: string }): Promise<number> {
    if (!this.deps.classifier && !this.deps.embedder) return 0;

    let enriched = 0;
    try {
      const products = await this.loadProducts(input.tenantId);

      for (;;) {
        const pending = await this.deps.interactions.findPendingEnrichment({
          tenantId: input.tenantId,
          dataSourceId: input.dataSourceId,
          take: BATCH_SIZE,
        });
        if (pending.length === 0) break;

        const texts = pending.map((row) =>
          row.subject ? `${row.subject}\n${row.body}` : row.body,
        );

        let classifications: ClassifiedInteraction[] = pending.map(() => ({
          intent: 'other',
          topics: [],
        }));
        if (this.deps.classifier) {
          try {
            classifications = await this.deps.classifier.classify(texts, { products });
          } catch (error) {
            logger.warn(
              {
                tenant_id: input.tenantId,
                operation: 'interaction_classify',
                err: error instanceof Error ? error.message : String(error),
              },
              'interaction classification failed',
            );
          }
        }

        let embeddings: Array<number[] | null> = pending.map(() => null);
        if (this.deps.embedder) {
          try {
            embeddings = await this.deps.embedder.embed(texts);
          } catch (error) {
            logger.warn(
              {
                tenant_id: input.tenantId,
                operation: 'interaction_embed',
                err: error instanceof Error ? error.message : String(error),
              },
              'interaction embedding failed',
            );
            break;
          }
        }

        for (let index = 0; index < pending.length; index += 1) {
          const row = pending[index]!;
          const embedding = embeddings[index];
          if (!embedding) continue;
          const classified = classifications[index] ?? { intent: 'other', topics: [] };
          try {
            await this.deps.interactions.updateEnrichment({
              tenantId: input.tenantId,
              id: row.id,
              intent: classified.intent as InteractionIntent,
              topics: classified.topics.slice(0, 5),
              sentiment: classified.sentiment ?? null,
              urgency: classified.urgency ?? null,
              productId: resolveProductMention(classified.productMention, row.body, products),
              embedding,
            });
            enriched += 1;
          } catch (error) {
            logger.warn(
              {
                tenant_id: input.tenantId,
                interaction_id: row.id,
                operation: 'interaction_enrich_persist',
                err: error instanceof Error ? error.message : String(error),
              },
              'failed to persist interaction enrichment',
            );
          }
        }

        if (pending.length < BATCH_SIZE) break;
      }
    } catch (error) {
      logger.warn(
        {
          tenant_id: input.tenantId,
          operation: 'interaction_enrich',
          err: error instanceof Error ? error.message : String(error),
        },
        'interaction enrichment aborted',
      );
    }

    return enriched;
  }
}
