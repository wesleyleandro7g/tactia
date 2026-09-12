import { z } from 'zod';
import {
  EMBED_PENDING_BATCH,
  FACT_CONTEXT_K,
  FACT_CONTEXT_MIN_SCORE,
  type BusinessFactRecord,
  type BusinessFactRepository,
  type BusinessFactSearchHit,
} from '@tactia/database';
import { AppError, ErrorCode, logger, type RequestContext } from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import type { TextEmbedder } from '../ports/embedder';

const emptyToNull = (value: unknown) => (value === '' || value === undefined ? null : value);

export const createBusinessFactSchema = z.object({
  kind: z.enum(['fact', 'event', 'preference']),
  text: z.string().trim().min(1).max(4000),
  entityType: z.preprocess(
    emptyToNull,
    z.enum(['seller', 'product', 'customer']).nullable().optional(),
  ),
  entityId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  validFrom: z.preprocess(emptyToNull, z.coerce.date().nullable().optional()),
  validTo: z.preprocess(emptyToNull, z.coerce.date().nullable().optional()),
  source: z.enum(['user', 'chat']).optional().default('user'),
});

export type BusinessFactDto = BusinessFactRecord & { indexed: boolean };

function toDto(fact: BusinessFactRecord): BusinessFactDto {
  return { ...fact, indexed: fact.embeddedAt != null };
}

export class BusinessFactService {
  constructor(
    private readonly facts: BusinessFactRepository,
    private readonly embedder?: TextEmbedder | null,
  ) {}

  async listActive(ctx: RequestContext) {
    assertTenantContext(ctx);
    const items = await this.facts.listActive(ctx.tenantId, new Date());
    return { items: items.map(toDto) };
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createBusinessFactSchema.parse(raw);
    const fact = await this.facts.create({
      tenantId: ctx.tenantId,
      kind: input.kind,
      text: input.text,
      entityType: input.entityType,
      entityId: input.entityId,
      validFrom: input.validFrom,
      validTo: input.validTo,
      source: input.source,
      createdBy: ctx.userId,
    });
    await this.embedOne(fact);
    const fresh = await this.facts.findById({ tenantId: ctx.tenantId, id: fact.id });
    return toDto(fresh ?? fact);
  }

  async remove(ctx: RequestContext, id: string) {
    assertRole(ctx, 'member');
    const fact = await this.facts.delete({ tenantId: ctx.tenantId, id });
    if (!fact) throw new AppError(ErrorCode.NOT_FOUND, 'Business fact not found');
    return toDto(fact);
  }

  async searchSemantic(
    ctx: RequestContext,
    input: { query: string; limit?: number; kinds?: string[] },
  ): Promise<{ items: Array<BusinessFactRecord & { score?: number }>; mode: 'semantic' | 'keyword' }> {
    assertTenantContext(ctx);
    const limit = input.limit ?? FACT_CONTEXT_K;
    const now = new Date();

    if (this.embedder) {
      try {
        const [embedding] = await this.embedder.embed([input.query]);
        if (embedding) {
          const items = await this.facts.searchByEmbedding({
            tenantId: ctx.tenantId,
            embedding,
            limit,
            now,
            kinds: input.kinds,
          });
          return { items, mode: 'semantic' };
        }
      } catch (error) {
        logger.warn(
          {
            tenant_id: ctx.tenantId,
            operation: 'fact_search_embed',
            err: error instanceof Error ? error.message : String(error),
          },
          'fact semantic search fell back to keyword',
        );
      }
    }

    const items = await this.facts.searchByKeyword({
      tenantId: ctx.tenantId,
      query: input.query,
      limit,
      now,
      kinds: input.kinds,
    });
    return { items, mode: 'keyword' };
  }

  /** Top-K for the chat system prompt: semantic when possible, else N most recent. */
  async forChatContext(ctx: RequestContext, query: string): Promise<BusinessFactDto[]> {
    assertTenantContext(ctx);
    if (this.embedder) {
      const result = await this.searchSemantic(ctx, { query, limit: FACT_CONTEXT_K });
      if (result.mode === 'semantic') {
        return result.items
          .filter((item) => ((item as BusinessFactSearchHit).score ?? 0) >= FACT_CONTEXT_MIN_SCORE)
          .slice(0, FACT_CONTEXT_K)
          .map(toDto);
      }
    }
    const items = await this.facts.listActive(ctx.tenantId, new Date());
    return items.slice(0, FACT_CONTEXT_K).map(toDto);
  }

  async embedPending(input: { tenantId: string }) {
    if (!this.embedder) return { embedded: 0 };
    const pending = await this.facts.findPendingEmbedding({
      tenantId: input.tenantId,
      take: EMBED_PENDING_BATCH,
    });
    let embedded = 0;
    for (const fact of pending) {
      const ok = await this.embedOne(fact);
      if (ok) embedded += 1;
    }
    return { embedded };
  }

  private async embedOne(fact: BusinessFactRecord): Promise<boolean> {
    if (!this.embedder) return false;
    try {
      const [embedding] = await this.embedder.embed([fact.text]);
      if (!embedding) return false;
      await this.facts.updateEmbedding({ tenantId: fact.tenantId, id: fact.id, embedding });
      return true;
    } catch (error) {
      logger.warn(
        {
          tenant_id: fact.tenantId,
          operation: 'fact_embed',
          fact_id: fact.id,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to embed business fact',
      );
      return false;
    }
  }
}
