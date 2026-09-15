import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient, type ProductStatus } from '../client';
import { asJson, asNullableJson } from '../json';
import { toVectorLiteral } from '../embeddings';

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export type CreateProductInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  name: string;
  sku?: string | null;
  category?: string | null;
  supplier?: string | null;
  cost?: number | null;
  price?: number | null;
  status?: ProductStatus;
  metadata?: unknown;
  customData?: unknown;
};

export class ProductRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateProductInput) {
    return this.db.product.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId ?? null,
        externalId: input.externalId ?? null,
        name: input.name,
        sku: input.sku ?? null,
        category: input.category ?? null,
        supplier: input.supplier ?? null,
        cost: input.cost ?? null,
        price: input.price ?? null,
        status: input.status ?? 'active',
        metadata: asJson(input.metadata),
        customData: asJson(input.customData ?? {}),
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.product.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
  }

  async list({
    tenantId,
    skip,
    take,
    status,
    search,
  }: {
    tenantId: string;
    skip: number;
    take: number;
    status?: ProductStatus;
    search?: string;
  }) {
    const where: Prisma.ProductWhereInput = {
      tenantId,
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
              { category: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.product.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.product.count({ where }),
    ]);
    return { items, total };
  }

  async update({
    tenantId,
    id,
    data,
  }: {
    tenantId: string;
    id: string;
    data: {
      name?: string;
      sku?: string | null;
      category?: string | null;
      cost?: number | null;
      price?: number | null;
      status?: ProductStatus;
      metadata?: unknown;
      customData?: unknown;
      externalId?: string | null;
    };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.product.update({
      where: { id },
      data: {
        name: data.name,
        sku: data.sku,
        category: data.category,
        cost: data.cost,
        price: data.price,
        status: data.status,
        externalId: data.externalId,
        metadata: asNullableJson(data.metadata),
        ...(data.customData !== undefined ? { customData: asJson(data.customData) } : {}),
      },
    });
  }

  /** See `CustomerRepository.findByExternalId` — `dataSourceId` is optional. */
  async findByExternalId({
    tenantId,
    dataSourceId,
    externalId,
  }: {
    tenantId: string;
    dataSourceId?: string;
    externalId: string;
  }) {
    return this.db.product.findFirst({
      where: {
        tenantId,
        externalId,
        deletedAt: null,
        ...(dataSourceId ? { dataSourceId } : {}),
      },
      select: { id: true, price: true },
    });
  }

  async upsertByExternalId(input: CreateProductInput & { dataSourceId: string; externalId: string }) {
    const existing = await this.db.product.findFirst({
      where: {
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        externalId: input.externalId,
        deletedAt: null,
      },
    });

    if (existing) {
      const updated = await this.db.product.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          sku: input.sku ?? null,
          category: input.category ?? null,
          supplier: input.supplier ?? null,
          cost: input.cost,
          price: input.price,
          status: input.status ?? existing.status,
          metadata: asJson(input.metadata),
          customData: asJson({
            ...(asRecord(existing.customData)),
            ...(asRecord(input.customData)),
          }),
        },
      });
      return { entity: updated, created: false };
    }

    const created = await this.create(input);
    return { entity: created, created: true };
  }

  async softDelete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'inactive' },
    });
  }

  async findPendingEmbedding({
    tenantId,
    take = 32,
  }: {
    tenantId: string;
    take?: number;
  }): Promise<Array<{
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    supplier: string | null;
    price: { toString(): string } | null;
  }>> {
    return this.db.$queryRaw`
      SELECT
        id,
        name,
        sku,
        category,
        supplier,
        price
      FROM products
      WHERE tenant_id = ${tenantId}::uuid
        AND deleted_at IS NULL
        AND (embedding IS NULL OR embedded_at IS NULL OR embedded_at < updated_at)
      ORDER BY updated_at DESC
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
      UPDATE products
      SET embedding = ${vector}::vector, embedded_at = CURRENT_TIMESTAMP
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `;
  }

  async searchByEmbedding({
    tenantId,
    embedding,
    limit = 8,
  }: {
    tenantId: string;
    embedding: number[];
    limit?: number;
  }) {
    const vector = toVectorLiteral(embedding);
    return this.db.$queryRaw<
      Array<{
        id: string;
        tenantId: string;
        name: string;
        sku: string | null;
        category: string | null;
        supplier: string | null;
        price: { toString(): string } | null;
        score: number;
      }>
    >`
      SELECT
        id,
        tenant_id AS "tenantId",
        name,
        sku,
        category,
        supplier,
        price,
        (1 - (embedding <=> ${vector}::vector))::float8 AS score
      FROM products
      WHERE tenant_id = ${tenantId}::uuid
        AND deleted_at IS NULL
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;
  }

  async searchCatalogKeyword({
    tenantId,
    query,
    limit = 8,
  }: {
    tenantId: string;
    query: string;
    limit?: number;
  }) {
    return this.db.product.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
          { category: { contains: query, mode: 'insensitive' } },
          { supplier: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        tenantId: true,
        name: true,
        sku: true,
        category: true,
        supplier: true,
        price: true,
      },
    });
  }
}
