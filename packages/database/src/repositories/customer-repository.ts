import { createId } from '@tactia/shared';
import { Prisma, type CustomerStatus, type PrismaClient } from '../client';
import { asJson, asNullableJson } from '../json';

export type CreateCustomerInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  document?: string | null;
  segment?: string | null;
  city?: string | null;
  state?: string | null;
  acquisitionSource?: string | null;
  status?: CustomerStatus;
  metadata?: unknown;
};

export class CustomerRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateCustomerInput) {
    return this.db.customer.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId ?? null,
        externalId: input.externalId ?? null,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        document: input.document ?? null,
        segment: input.segment ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        acquisitionSource: input.acquisitionSource ?? null,
        status: input.status ?? 'active',
        metadata: asJson(input.metadata),
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.customer.findFirst({
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
    status?: CustomerStatus;
    search?: string;
  }) {
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { document: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.customer.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.customer.count({ where }),
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
      email?: string | null;
      phone?: string | null;
      document?: string | null;
      status?: CustomerStatus;
      metadata?: unknown;
      externalId?: string | null;
    };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.customer.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        document: data.document,
        status: data.status,
        externalId: data.externalId,
        metadata: asNullableJson(data.metadata),
      },
    });
  }

  /**
   * Lookup used by the normalizer to resolve references coming from a source.
   * Without `dataSourceId` the search is tenant-wide — used as a fallback when
   * a sales file lives in a different DataSource than its customers file.
   */
  async findByExternalId({
    tenantId,
    dataSourceId,
    externalId,
  }: {
    tenantId: string;
    dataSourceId?: string;
    externalId: string;
  }) {
    return this.db.customer.findFirst({
      where: {
        tenantId,
        externalId,
        deletedAt: null,
        ...(dataSourceId ? { dataSourceId } : {}),
      },
      select: { id: true },
    });
  }

  async findByEmail({ tenantId, email }: { tenantId: string; email: string }) {
    return this.db.customer.findFirst({
      where: { tenantId, email: { equals: email, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
  }

  async findByPhone({ tenantId, phone }: { tenantId: string; phone: string }) {
    return this.db.customer.findFirst({
      where: { tenantId, phone, deletedAt: null },
      select: { id: true },
    });
  }

  async upsertByExternalId(input: CreateCustomerInput & { dataSourceId: string; externalId: string }) {
    const existing = await this.db.customer.findFirst({
      where: {
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        externalId: input.externalId,
        deletedAt: null,
      },
    });

    if (existing) {
      const updated = await this.db.customer.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          document: input.document ?? null,
          segment: input.segment ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          acquisitionSource: input.acquisitionSource ?? null,
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
    return this.db.customer.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'inactive' },
    });
  }
}
