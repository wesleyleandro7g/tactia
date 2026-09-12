import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient } from '../client';
import { toVectorLiteral } from '../embeddings';

export type CreateBusinessFactInput = {
  tenantId: string;
  kind: string;
  text: string;
  entityType?: string | null;
  entityId?: string | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  source?: string;
  createdBy?: string | null;
};

export type BusinessFactRecord = {
  id: string;
  tenantId: string;
  kind: string;
  text: string;
  entityType: string | null;
  entityId: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  source: string;
  createdBy: string | null;
  embeddedAt: Date | null;
  createdAt: Date;
};

export type BusinessFactSearchHit = BusinessFactRecord & { score: number };

const businessFactSelect = {
  id: true,
  tenantId: true,
  kind: true,
  text: true,
  entityType: true,
  entityId: true,
  validFrom: true,
  validTo: true,
  source: true,
  createdBy: true,
  embeddedAt: true,
  createdAt: true,
} satisfies Prisma.BusinessFactSelect;

function activeWhere(tenantId: string, now: Date): Prisma.BusinessFactWhereInput {
  return {
    tenantId,
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      { OR: [{ validTo: null }, { validTo: { gte: now } }] },
    ],
  };
}

export class BusinessFactRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateBusinessFactInput): Promise<BusinessFactRecord> {
    return this.db.businessFact.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        kind: input.kind,
        text: input.text,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        source: input.source ?? 'user',
        createdBy: input.createdBy ?? null,
      },
      select: businessFactSelect,
    });
  }

  async listActive(tenantId: string, now: Date): Promise<BusinessFactRecord[]> {
    return this.db.businessFact.findMany({
      where: activeWhere(tenantId, now),
      orderBy: { createdAt: 'desc' },
      select: businessFactSelect,
    });
  }

  async list(tenantId: string): Promise<BusinessFactRecord[]> {
    return this.db.businessFact.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: businessFactSelect,
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.businessFact.findFirst({
      where: { id, tenantId },
      select: businessFactSelect,
    });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.businessFact.delete({ where: { id } });
    return existing;
  }

  async findPendingEmbedding({
    tenantId,
    take = 32,
  }: {
    tenantId: string;
    take?: number;
  }): Promise<BusinessFactRecord[]> {
    return this.db.$queryRaw<BusinessFactRecord[]>`
      SELECT
        id,
        tenant_id AS "tenantId",
        kind,
        text,
        entity_type AS "entityType",
        entity_id AS "entityId",
        valid_from AS "validFrom",
        valid_to AS "validTo",
        source,
        created_by AS "createdBy",
        embedded_at AS "embeddedAt",
        created_at AS "createdAt"
      FROM business_facts
      WHERE tenant_id = ${tenantId}::uuid
        AND embedding IS NULL
      ORDER BY created_at DESC
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
      UPDATE business_facts
      SET embedding = ${vector}::vector, embedded_at = CURRENT_TIMESTAMP
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `;
  }

  async searchByEmbedding({
    tenantId,
    embedding,
    limit = 8,
    now,
    kinds,
  }: {
    tenantId: string;
    embedding: number[];
    limit?: number;
    now: Date;
    kinds?: string[];
  }): Promise<BusinessFactSearchHit[]> {
    const vector = toVectorLiteral(embedding);
    const rows = await this.db.$queryRaw<BusinessFactSearchHit[]>`
      SELECT
        id,
        tenant_id AS "tenantId",
        kind,
        text,
        entity_type AS "entityType",
        entity_id AS "entityId",
        valid_from AS "validFrom",
        valid_to AS "validTo",
        source,
        created_by AS "createdBy",
        embedded_at AS "embeddedAt",
        created_at AS "createdAt",
        (1 - (embedding <=> ${vector}::vector))::float8 AS score
      FROM business_facts
      WHERE tenant_id = ${tenantId}::uuid
        AND embedding IS NOT NULL
        AND (valid_from IS NULL OR valid_from <= ${now})
        AND (valid_to IS NULL OR valid_to >= ${now})
        ${kinds && kinds.length > 0 ? Prisma.sql`AND kind IN (${Prisma.join(kinds)})` : Prisma.empty}
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;
    return rows;
  }

  async searchByKeyword({
    tenantId,
    query,
    limit = 8,
    now,
    kinds,
  }: {
    tenantId: string;
    query: string;
    limit?: number;
    now: Date;
    kinds?: string[];
  }): Promise<BusinessFactRecord[]> {
    return this.db.businessFact.findMany({
      where: {
        ...activeWhere(tenantId, now),
        text: { contains: query, mode: 'insensitive' },
        ...(kinds && kinds.length > 0 ? { kind: { in: kinds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: businessFactSelect,
    });
  }
}
