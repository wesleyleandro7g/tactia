import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient, type ProductStatus } from '../client';
import { asJson, asNullableJson } from '../json';

export type CreateProductInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  name: string;
  sku?: string | null;
  category?: string | null;
  cost?: number | null;
  price?: number | null;
  status?: ProductStatus;
  metadata?: unknown;
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
        cost: input.cost ?? null,
        price: input.price ?? null,
        status: input.status ?? 'active',
        metadata: asJson(input.metadata),
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
      },
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
          cost: input.cost,
          price: input.price,
          status: input.status ?? existing.status,
          metadata: asJson(input.metadata),
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
}
