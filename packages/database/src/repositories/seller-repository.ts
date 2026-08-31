import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient, type SellerStatus } from '../client';

export type CreateSellerInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  userId?: string | null;
  name: string;
  email?: string | null;
  status?: SellerStatus;
};

export class SellerRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateSellerInput) {
    return this.db.seller.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId ?? null,
        externalId: input.externalId ?? null,
        userId: input.userId ?? null,
        name: input.name,
        email: input.email ?? null,
        status: input.status ?? 'active',
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.seller.findFirst({
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
    status?: SellerStatus;
    search?: string;
  }) {
    const where: Prisma.SellerWhereInput = {
      tenantId,
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.seller.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.seller.count({ where }),
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
      userId?: string | null;
      name?: string;
      email?: string | null;
      status?: SellerStatus;
      externalId?: string | null;
    };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.seller.update({
      where: { id },
      data: {
        userId: data.userId,
        name: data.name,
        email: data.email,
        status: data.status,
        externalId: data.externalId,
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
    return this.db.seller.findFirst({
      where: {
        tenantId,
        externalId,
        deletedAt: null,
        ...(dataSourceId ? { dataSourceId } : {}),
      },
      select: { id: true },
    });
  }

  async upsertByExternalId(input: CreateSellerInput & { dataSourceId: string; externalId: string }) {
    const existing = await this.db.seller.findFirst({
      where: {
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        externalId: input.externalId,
        deletedAt: null,
      },
    });

    if (existing) {
      const updated = await this.db.seller.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          email: input.email ?? null,
          status: input.status ?? existing.status,
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
    return this.db.seller.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'inactive' },
    });
  }
}
