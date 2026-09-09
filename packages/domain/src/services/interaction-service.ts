import type {
  CustomerRepository,
  InteractionChannel,
  InteractionIntent,
  InteractionRepository,
} from '@tactia/database';
import {
  AppError,
  ErrorCode,
  paginationArgs,
  type RequestContext,
} from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import {
  createInteractionSchema,
  listInteractionQuerySchema,
} from '../schemas/business';
import { AuditAction, type AuditLogService } from './audit-log-service';
import type { InteractionEnrichmentService } from './interaction-enrichment-service';

export class InteractionService {
  constructor(
    private readonly interactions: InteractionRepository,
    private readonly customers: CustomerRepository,
    private readonly auditLogs: AuditLogService,
    private readonly enrichment?: InteractionEnrichmentService,
  ) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listInteractionQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const from = parsed.from ? new Date(parsed.from) : undefined;
    const to = parsed.to ? new Date(parsed.to) : undefined;
    if (from && Number.isNaN(from.getTime())) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Data inicial inválida');
    }
    if (to && Number.isNaN(to.getTime())) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Data final inválida');
    }

    const result = await this.interactions.list({
      tenantId: ctx.tenantId,
      skip,
      take,
      channel: parsed.channel as InteractionChannel | undefined,
      intent: parsed.intent as InteractionIntent | undefined,
      customerId: parsed.customerId,
      search: parsed.search,
      from,
      to,
    });
    return { ...result, pagination: { page: parsed.page, pageSize: parsed.pageSize } };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const interaction = await this.interactions.findById({ tenantId: ctx.tenantId, id });
    if (!interaction) throw new AppError(ErrorCode.NOT_FOUND, 'Interaction not found');
    return interaction;
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createInteractionSchema.parse(raw);

    if (input.customerId) {
      const customer = await this.customers.findById({
        tenantId: ctx.tenantId,
        id: input.customerId,
      });
      if (!customer) throw new AppError(ErrorCode.NOT_FOUND, 'Customer not found');
    }

    const interaction = await this.interactions.create({
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      channel: input.channel,
      direction: input.direction,
      subject: input.subject,
      body: input.body,
      occurredAt: input.occurredAt ?? new Date(),
      externalId: input.externalId,
      metadata: input.metadata ?? undefined,
    });

    await this.auditLogs.record(ctx, {
      action: AuditAction.INTERACTION_CREATED,
      entityType: 'interaction',
      entityId: interaction.id,
      metadata: { channel: interaction.channel, customerId: interaction.customerId },
    });

    if (this.enrichment) {
      await this.enrichment.enrichPending({ tenantId: ctx.tenantId });
    }

    return this.interactions.findById({ tenantId: ctx.tenantId, id: interaction.id });
  }

  async searchSemantic(
    ctx: RequestContext,
    input: {
      embedding: number[];
      from: Date;
      to: Date;
      customerId?: string;
      intent?: InteractionIntent;
      limit?: number;
    },
  ) {
    assertTenantContext(ctx);
    return this.interactions.searchByEmbedding({
      tenantId: ctx.tenantId,
      embedding: input.embedding,
      from: input.from,
      to: input.to,
      customerId: input.customerId,
      intent: input.intent,
      limit: input.limit,
    });
  }

  async enrichPending(ctx: RequestContext) {
    assertRole(ctx, 'member');
    if (!this.enrichment) return { enriched: 0 };
    const enriched = await this.enrichment.enrichPending({ tenantId: ctx.tenantId });
    return { enriched };
  }
}
