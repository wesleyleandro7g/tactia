import { createId } from '@tactia/shared';
import {
  Prisma,
  type InteractionChannel,
  type InteractionDirection,
  type InteractionIntent,
  type InteractionUrgency,
  type PrismaClient,
} from '../client';
import { asJson } from '../json';

export const EMBEDDING_DIMENSIONS = 1536;

export type CreateInteractionInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  customerId?: string | null;
  channel: InteractionChannel;
  direction?: InteractionDirection;
  subject?: string | null;
  body: string;
  occurredAt: Date;
  intent?: InteractionIntent | null;
  topics?: string[];
  metadata?: unknown;
};

export type InteractionRecord = {
  id: string;
  tenantId: string;
  dataSourceId: string | null;
  externalId: string | null;
  customerId: string | null;
  channel: InteractionChannel;
  direction: InteractionDirection;
  subject: string | null;
  body: string;
  occurredAt: Date;
  intent: InteractionIntent | null;
  topics: string[];
  sentiment: { toNumber(): number } | null;
  urgency: InteractionUrgency | null;
  productId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type InteractionSearchHit = InteractionRecord & { score: number };

const interactionSelect = {
  id: true,
  tenantId: true,
  dataSourceId: true,
  externalId: true,
  customerId: true,
  channel: true,
  direction: true,
  subject: true,
  body: true,
  occurredAt: true,
  intent: true,
  topics: true,
  sentiment: true,
  urgency: true,
  productId: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InteractionSelect;

function toVectorLiteral(values: number[]): string {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding must have ${EMBEDDING_DIMENSIONS} dimensions`);
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Embedding contains a non-finite value');
  }
  return `[${values.join(',')}]`;
}

export class InteractionRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateInteractionInput): Promise<InteractionRecord> {
    return this.db.interaction.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId ?? null,
        externalId: input.externalId ?? null,
        customerId: input.customerId ?? null,
        channel: input.channel,
        direction: input.direction ?? 'inbound',
        subject: input.subject ?? null,
        body: input.body,
        occurredAt: input.occurredAt,
        intent: input.intent ?? null,
        topics: input.topics ?? [],
        metadata: asJson(input.metadata),
      },
      select: interactionSelect,
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.interaction.findFirst({
      where: { id, tenantId },
      select: interactionSelect,
    });
  }

  async list({
    tenantId,
    skip,
    take,
    channel,
    intent,
    urgency,
    productId,
    customerId,
    search,
    from,
    to,
  }: {
    tenantId: string;
    skip: number;
    take: number;
    channel?: InteractionChannel;
    intent?: InteractionIntent;
    urgency?: InteractionUrgency;
    productId?: string;
    customerId?: string;
    search?: string;
    from?: Date;
    to?: Date;
  }) {
    const where: Prisma.InteractionWhereInput = {
      tenantId,
      ...(channel ? { channel } : {}),
      ...(intent ? { intent } : {}),
      ...(urgency ? { urgency } : {}),
      ...(productId ? { productId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
        : {}),
      ...(search ? { body: { contains: search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.interaction.findMany({
        where,
        skip,
        take,
        orderBy: { occurredAt: 'desc' },
        select: interactionSelect,
      }),
      this.db.interaction.count({ where }),
    ]);
    return { items, total };
  }

  async upsertByExternalId(
    input: CreateInteractionInput & { dataSourceId: string; externalId: string },
  ) {
    const existing = await this.db.interaction.findFirst({
      where: {
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        externalId: input.externalId,
      },
      select: { id: true, body: true },
    });

    if (existing) {
      const bodyChanged = existing.body !== input.body;
      const updated = await this.db.interaction.update({
        where: { id: existing.id },
        data: {
          customerId: input.customerId ?? null,
          channel: input.channel,
          direction: input.direction ?? 'inbound',
          subject: input.subject ?? null,
          body: input.body,
          occurredAt: input.occurredAt,
          metadata: asJson(input.metadata),
          ...(bodyChanged
            ? { intent: null, topics: [], sentiment: null, urgency: null, productId: null }
            : {
                ...(input.intent !== undefined ? { intent: input.intent } : {}),
                ...(input.topics !== undefined ? { topics: input.topics } : {}),
              }),
        },
        select: interactionSelect,
      });
      if (bodyChanged) {
        await this.clearEmbedding(existing.id, input.tenantId);
      }
      return { entity: updated, created: false, bodyChanged };
    }

    const created = await this.create(input);
    return { entity: created, created: true, bodyChanged: false };
  }

  async findPendingEnrichment({
    tenantId,
    dataSourceId,
    take = 64,
  }: {
    tenantId: string;
    dataSourceId?: string;
    take?: number;
  }): Promise<Array<{ id: string; body: string; subject: string | null }>> {
    return this.db.$queryRaw<Array<{ id: string; body: string; subject: string | null }>>`
      SELECT id, body, subject
      FROM interactions
      WHERE tenant_id = ${tenantId}::uuid
        AND embedding IS NULL
        ${dataSourceId ? Prisma.sql`AND data_source_id = ${dataSourceId}::uuid` : Prisma.empty}
      ORDER BY occurred_at DESC
      LIMIT ${take}
    `;
  }

  async updateEnrichment({
    tenantId,
    id,
    intent,
    topics,
    sentiment,
    urgency,
    productId,
    embedding,
  }: {
    tenantId: string;
    id: string;
    intent: InteractionIntent;
    topics: string[];
    sentiment?: number | null;
    urgency?: InteractionUrgency | null;
    productId?: string | null;
    embedding: number[];
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return;
    await this.db.interaction.update({
      where: { id },
      data: {
        intent,
        topics,
        sentiment: sentiment == null ? null : Math.max(-1, Math.min(1, sentiment)),
        urgency: urgency ?? null,
        productId: productId ?? null,
      },
    });
    const vector = toVectorLiteral(embedding);
    await this.db.$executeRaw`
      UPDATE interactions
      SET embedding = ${vector}::vector
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `;
  }

  async searchByEmbedding({
    tenantId,
    embedding,
    from,
    to,
    customerId,
    intent,
    limit = 10,
  }: {
    tenantId: string;
    embedding: number[];
    from: Date;
    to: Date;
    customerId?: string;
    intent?: InteractionIntent;
    limit?: number;
  }): Promise<InteractionSearchHit[]> {
    const vector = toVectorLiteral(embedding);
    const rows = await this.db.$queryRaw<
      Array<
        InteractionRecord & {
          score: number;
        }
      >
    >`
      SELECT
        id,
        tenant_id AS "tenantId",
        data_source_id AS "dataSourceId",
        external_id AS "externalId",
        customer_id AS "customerId",
        channel,
        direction,
        subject,
        body,
        occurred_at AS "occurredAt",
        intent,
        topics,
        sentiment,
        urgency,
        product_id AS "productId",
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        (1 - (embedding <=> ${vector}::vector))::float8 AS score
      FROM interactions
      WHERE tenant_id = ${tenantId}::uuid
        AND embedding IS NOT NULL
        AND occurred_at >= ${from}
        AND occurred_at < ${to}
        ${customerId ? Prisma.sql`AND customer_id = ${customerId}::uuid` : Prisma.empty}
        ${intent ? Prisma.sql`AND intent = ${intent}::"InteractionIntent"` : Prisma.empty}
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;
    return rows;
  }

  private async clearEmbedding(id: string, tenantId: string) {
    await this.db.$executeRaw`
      UPDATE interactions
      SET embedding = NULL
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `;
  }
}
