import { createId } from '@tactia/shared';
import { Prisma, type EpisodeKind, type EpisodeOutcome, type PrismaClient } from '../client';
import { toVectorLiteral } from '../embeddings';

export type CreateEpisodeInput = {
  tenantId: string;
  kind: EpisodeKind;
  outcome: EpisodeOutcome;
  text: string;
  actionExecutionId?: string | null;
  approvalId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  occurredAt: Date;
};

export type EpisodeRecord = {
  id: string;
  tenantId: string;
  kind: EpisodeKind;
  outcome: EpisodeOutcome;
  text: string;
  actionExecutionId: string | null;
  approvalId: string | null;
  entityType: string | null;
  entityId: string | null;
  embeddedAt: Date | null;
  occurredAt: Date;
  createdAt: Date;
};

export type EpisodeSearchHit = EpisodeRecord & { score: number };

const episodeSelect = {
  id: true,
  tenantId: true,
  kind: true,
  outcome: true,
  text: true,
  actionExecutionId: true,
  approvalId: true,
  entityType: true,
  entityId: true,
  embeddedAt: true,
  occurredAt: true,
  createdAt: true,
} satisfies Prisma.EpisodeSelect;

export class EpisodeRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateEpisodeInput): Promise<EpisodeRecord> {
    return this.db.episode.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        kind: input.kind,
        outcome: input.outcome,
        text: input.text,
        actionExecutionId: input.actionExecutionId ?? null,
        approvalId: input.approvalId ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        occurredAt: input.occurredAt,
      },
      select: episodeSelect,
    });
  }

  async findByUnique({
    tenantId,
    actionExecutionId,
    outcome,
  }: {
    tenantId: string;
    actionExecutionId: string;
    outcome: EpisodeOutcome;
  }) {
    return this.db.episode.findFirst({
      where: { tenantId, actionExecutionId, outcome },
      select: episodeSelect,
    });
  }

  async listRecent({ tenantId, take = 50 }: { tenantId: string; take?: number }): Promise<EpisodeRecord[]> {
    return this.db.episode.findMany({
      where: { tenantId },
      orderBy: { occurredAt: 'desc' },
      take,
      select: episodeSelect,
    });
  }

  async findPendingEmbedding({
    tenantId,
    take = 32,
  }: {
    tenantId: string;
    take?: number;
  }): Promise<EpisodeRecord[]> {
    return this.db.$queryRaw<EpisodeRecord[]>`
      SELECT
        id,
        tenant_id AS "tenantId",
        kind,
        outcome,
        text,
        action_execution_id AS "actionExecutionId",
        approval_id AS "approvalId",
        entity_type AS "entityType",
        entity_id AS "entityId",
        embedded_at AS "embeddedAt",
        occurred_at AS "occurredAt",
        created_at AS "createdAt"
      FROM episodes
      WHERE tenant_id = ${tenantId}::uuid
        AND embedding IS NULL
      ORDER BY occurred_at DESC
      LIMIT ${take}
    `;
  }

  async updateEmbedding({
    tenantId,
    id,
    embedding,
  }: {
    tenantId: string;
    id: string;
    embedding: number[];
  }): Promise<void> {
    const vector = toVectorLiteral(embedding);
    await this.db.$executeRaw`
      UPDATE episodes
      SET embedding = ${vector}::vector, embedded_at = CURRENT_TIMESTAMP
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `;
  }

  async searchByEmbedding({
    tenantId,
    embedding,
    limit = 8,
    outcome,
  }: {
    tenantId: string;
    embedding: number[];
    limit?: number;
    outcome?: EpisodeOutcome;
  }): Promise<EpisodeSearchHit[]> {
    const vector = toVectorLiteral(embedding);
    return this.db.$queryRaw<EpisodeSearchHit[]>`
      SELECT
        id,
        tenant_id AS "tenantId",
        kind,
        outcome,
        text,
        action_execution_id AS "actionExecutionId",
        approval_id AS "approvalId",
        entity_type AS "entityType",
        entity_id AS "entityId",
        embedded_at AS "embeddedAt",
        occurred_at AS "occurredAt",
        created_at AS "createdAt",
        (1 - (embedding <=> ${vector}::vector))::float8 AS score
      FROM episodes
      WHERE tenant_id = ${tenantId}::uuid
        AND embedding IS NOT NULL
        ${outcome ? Prisma.sql`AND outcome = ${outcome}::"EpisodeOutcome"` : Prisma.empty}
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;
  }

  async searchByKeyword({
    tenantId,
    query,
    limit = 8,
    outcome,
  }: {
    tenantId: string;
    query: string;
    limit?: number;
    outcome?: EpisodeOutcome;
  }): Promise<EpisodeRecord[]> {
    return this.db.episode.findMany({
      where: {
        tenantId,
        text: { contains: query, mode: 'insensitive' },
        ...(outcome ? { outcome } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      select: episodeSelect,
    });
  }
}
