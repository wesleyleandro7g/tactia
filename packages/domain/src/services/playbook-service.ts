import {
  EMBED_PENDING_BATCH,
  PLAYBOOK_CONTEXT_K,
  type PlaybookRecord,
  type PlaybookRepository,
} from '@tactia/database';
import { AppError, ErrorCode, logger, type RequestContext } from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { AuditAction } from './audit-log-service';
import type { AuditLogService } from './audit-log-service';
import type { TextEmbedder } from '../ports/embedder';
import {
  createPlaybookSchema,
  playbookEmbeddingText,
  playbookStepSchema,
  updatePlaybookSchema,
  type PlaybookStep,
} from '../memory/playbook';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

function parseSteps(value: unknown): PlaybookStep[] {
  return playbookStepSchema.array().parse(value ?? []);
}

export class PlaybookService {
  constructor(
    private readonly playbooks: PlaybookRepository,
    private readonly auditLogs: AuditLogService,
    private readonly embedder?: TextEmbedder | null,
  ) {}

  async list(ctx: RequestContext, query: { enabled?: boolean } = {}) {
    assertTenantContext(ctx);
    const items = await this.playbooks.list({
      tenantId: ctx.tenantId,
      enabled: query.enabled,
    });
    return { items: items.map((item) => this.serialize(item)) };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const playbook = await this.playbooks.findById({ tenantId: ctx.tenantId, id });
    if (!playbook) throw new AppError(ErrorCode.NOT_FOUND, 'Playbook not found');
    return this.serialize(playbook);
  }

  async getBySlugOrId(ctx: RequestContext, input: { slug?: string; id?: string }) {
    assertTenantContext(ctx);
    if (input.id) {
      return this.playbooks.findById({ tenantId: ctx.tenantId, id: input.id });
    }
    if (input.slug) {
      return this.playbooks.findBySlug({ tenantId: ctx.tenantId, slug: input.slug });
    }
    return null;
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createPlaybookSchema.parse(raw);
    let playbook: PlaybookRecord;
    try {
      playbook = await this.playbooks.create({
        tenantId: ctx.tenantId,
        slug: input.slug,
        title: input.title,
        trigger: input.trigger,
        steps: input.steps,
        enabled: input.enabled,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(ErrorCode.CONFLICT, 'Já existe um playbook com este slug');
      }
      throw error;
    }

    await this.auditLogs.record(ctx, {
      action: AuditAction.PLAYBOOK_CREATED,
      entityType: 'playbook',
      entityId: playbook.id,
      metadata: { slug: playbook.slug },
    });
    await this.embedOne(playbook);
    const fresh = await this.playbooks.findById({ tenantId: ctx.tenantId, id: playbook.id });
    return this.serialize(fresh ?? playbook);
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertRole(ctx, 'member');
    const existing = await this.playbooks.findById({ tenantId: ctx.tenantId, id });
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'Playbook not found');
    const input = updatePlaybookSchema.parse(raw);

    let playbook: PlaybookRecord;
    try {
      playbook = await this.playbooks.update(
        { tenantId: ctx.tenantId, id },
        {
          slug: input.slug,
          title: input.title,
          trigger: input.trigger,
          steps: input.steps,
          enabled: input.enabled,
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(ErrorCode.CONFLICT, 'Já existe um playbook com este slug');
      }
      throw error;
    }

    await this.auditLogs.record(ctx, {
      action: AuditAction.PLAYBOOK_UPDATED,
      entityType: 'playbook',
      entityId: playbook.id,
      metadata: { slug: playbook.slug },
    });
    await this.embedOne(playbook);
    const fresh = await this.playbooks.findById({ tenantId: ctx.tenantId, id: playbook.id });
    return this.serialize(fresh ?? playbook);
  }

  async remove(ctx: RequestContext, id: string) {
    assertRole(ctx, 'member');
    const playbook = await this.playbooks.delete({ tenantId: ctx.tenantId, id });
    if (!playbook) throw new AppError(ErrorCode.NOT_FOUND, 'Playbook not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.PLAYBOOK_DELETED,
      entityType: 'playbook',
      entityId: playbook.id,
      metadata: { slug: playbook.slug },
    });
    return this.serialize(playbook);
  }

  async forChatContext(ctx: RequestContext, query: string) {
    assertTenantContext(ctx);
    if (this.embedder) {
      try {
        const [embedding] = await this.embedder.embed([query]);
        if (embedding) {
          const items = await this.playbooks.searchByEmbedding({
            tenantId: ctx.tenantId,
            embedding,
            limit: PLAYBOOK_CONTEXT_K,
            enabled: true,
          });
          return items.slice(0, PLAYBOOK_CONTEXT_K).map((item) => this.serialize(item));
        }
      } catch (error) {
        logger.warn(
          {
            tenant_id: ctx.tenantId,
            operation: 'playbook_context_embed',
            err: error instanceof Error ? error.message : String(error),
          },
          'playbook context fell back to recent',
        );
      }
    }
    const items = await this.playbooks.list({ tenantId: ctx.tenantId, enabled: true });
    return items.slice(0, PLAYBOOK_CONTEXT_K).map((item) => this.serialize(item));
  }

  async embedPending(input: { tenantId: string }) {
    if (!this.embedder) return { embedded: 0 };
    const pending = await this.playbooks.findPendingEmbedding({
      tenantId: input.tenantId,
      take: EMBED_PENDING_BATCH,
    });
    let embedded = 0;
    for (const playbook of pending) {
      if (await this.embedOne(playbook)) embedded += 1;
    }
    return { embedded };
  }

  serialize(playbook: PlaybookRecord) {
    return {
      id: playbook.id,
      tenantId: playbook.tenantId,
      slug: playbook.slug,
      title: playbook.title,
      trigger: playbook.trigger,
      steps: parseSteps(playbook.steps),
      enabled: playbook.enabled,
      indexed: playbook.embeddedAt != null,
      createdAt: playbook.createdAt,
      updatedAt: playbook.updatedAt,
    };
  }

  private async embedOne(playbook: PlaybookRecord): Promise<boolean> {
    if (!this.embedder) return false;
    try {
      const steps = parseSteps(playbook.steps);
      const [embedding] = await this.embedder.embed([
        playbookEmbeddingText({ title: playbook.title, trigger: playbook.trigger, steps }),
      ]);
      if (!embedding) return false;
      await this.playbooks.updateEmbedding({
        tenantId: playbook.tenantId,
        id: playbook.id,
        embedding,
      });
      return true;
    } catch (error) {
      logger.warn(
        {
          tenant_id: playbook.tenantId,
          operation: 'playbook_embed',
          playbook_id: playbook.id,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to embed playbook',
      );
      return false;
    }
  }
}
