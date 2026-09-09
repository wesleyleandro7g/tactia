import type { InteractionIntent, InteractionRepository } from '@tactia/database';
import { logger } from '@tactia/shared';
import type {
  ClassifiedInteraction,
  InteractionClassifier,
  InteractionEmbedder,
} from '../ports/interaction-enrichment';

const BATCH_SIZE = 32;

export type InteractionEnrichmentDeps = {
  interactions: InteractionRepository;
  classifier?: InteractionClassifier | null;
  embedder?: InteractionEmbedder | null;
};

/**
 * Classifies and embeds pending interactions after sync/create.
 * Provider failures are logged and never thrown to the caller.
 */
export class InteractionEnrichmentService {
  constructor(private readonly deps: InteractionEnrichmentDeps) {}

  async enrichPending(input: { tenantId: string; dataSourceId?: string }): Promise<number> {
    if (!this.deps.classifier && !this.deps.embedder) return 0;

    let enriched = 0;
    try {
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
            classifications = await this.deps.classifier.classify(texts);
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
