import {
  EMBED_PENDING_BATCH,
  EPISODE_SEARCH_LIMIT,
  type CreateEpisodeInput,
  type EpisodeRecord,
  type EpisodeRepository,
  type EpisodeOutcome,
} from '@tactia/database';
import { logger, type RequestContext } from '@tactia/shared';
import { assertTenantContext } from '../authz';
import type { TextEmbedder } from '../ports/embedder';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

export class EpisodeService {
  constructor(
    private readonly episodes: EpisodeRepository,
    private readonly embedder?: TextEmbedder | null,
  ) {}

  /**
   * Idempotent on (tenantId, actionExecutionId, outcome) when execution id is set.
   * Embed failures never throw — the episode row stays pending for backfill.
   */
  async record(input: CreateEpisodeInput): Promise<EpisodeRecord | null> {
    if (input.actionExecutionId) {
      const existing = await this.episodes.findByUnique({
        tenantId: input.tenantId,
        actionExecutionId: input.actionExecutionId,
        outcome: input.outcome,
      });
      if (existing) return existing;
    }

    let episode: EpisodeRecord;
    try {
      episode = await this.episodes.create(input);
    } catch (error) {
      if (isUniqueViolation(error) && input.actionExecutionId) {
        return this.episodes.findByUnique({
          tenantId: input.tenantId,
          actionExecutionId: input.actionExecutionId,
          outcome: input.outcome,
        });
      }
      throw error;
    }

    await this.embedOne(episode);
    return episode;
  }

  async listRecent(ctx: RequestContext, take = 50) {
    assertTenantContext(ctx);
    return { items: await this.episodes.listRecent({ tenantId: ctx.tenantId, take }) };
  }

  async searchSemantic(
    ctx: RequestContext,
    input: { query: string; limit?: number; outcome?: EpisodeOutcome },
  ): Promise<{ items: Array<EpisodeRecord & { score?: number }>; mode: 'semantic' | 'keyword' }> {
    assertTenantContext(ctx);
    const limit = input.limit ?? EPISODE_SEARCH_LIMIT;

    if (this.embedder) {
      try {
        const [embedding] = await this.embedder.embed([input.query]);
        if (embedding) {
          const items = await this.episodes.searchByEmbedding({
            tenantId: ctx.tenantId,
            embedding,
            limit,
            outcome: input.outcome,
          });
          return { items, mode: 'semantic' };
        }
      } catch (error) {
        logger.warn(
          {
            tenant_id: ctx.tenantId,
            operation: 'episode_search_embed',
            err: error instanceof Error ? error.message : String(error),
          },
          'episode semantic search fell back to keyword',
        );
      }
    }

    const items = await this.episodes.searchByKeyword({
      tenantId: ctx.tenantId,
      query: input.query,
      limit,
      outcome: input.outcome,
    });
    return { items, mode: 'keyword' };
  }

  async embedPending(input: { tenantId: string }) {
    if (!this.embedder) return { embedded: 0 };
    const pending = await this.episodes.findPendingEmbedding({
      tenantId: input.tenantId,
      take: EMBED_PENDING_BATCH,
    });
    let embedded = 0;
    for (const episode of pending) {
      if (await this.embedOne(episode)) embedded += 1;
    }
    return { embedded };
  }

  private async embedOne(episode: EpisodeRecord): Promise<boolean> {
    if (!this.embedder) return false;
    try {
      const [embedding] = await this.embedder.embed([episode.text]);
      if (!embedding) return false;
      await this.episodes.updateEmbedding({
        tenantId: episode.tenantId,
        id: episode.id,
        embedding,
      });
      return true;
    } catch (error) {
      logger.warn(
        {
          tenant_id: episode.tenantId,
          operation: 'episode_embed',
          episode_id: episode.id,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to embed episode',
      );
      return false;
    }
  }
}
