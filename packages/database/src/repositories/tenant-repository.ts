import { createId } from '@tactia/shared';
import type { Prisma, PrismaClient, TenantStatus } from '../client';

export type BackofficeTenantListQuery = {
  skip: number;
  take: number;
  q?: string;
  status?: TenantStatus;
};

export type CreateTenantInput = {
  name: string;
  slug: string;
  timezone?: string;
  currency?: string;
};

export class TenantRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateTenantInput) {
    return this.db.tenant.create({
      data: {
        id: createId(),
        name: input.name,
        slug: input.slug,
        timezone: input.timezone ?? 'America/Sao_Paulo',
        currency: input.currency ?? 'BRL',
      },
    });
  }

  async findById({ tenantId }: { tenantId: string }) {
    return this.db.tenant.findFirst({
      where: { id: tenantId, status: { not: 'deleted' } },
    });
  }

  /** Backoffice: includes suspended tenants; hides only soft-deleted ones. */
  async findByIdForOperator(id: string) {
    return this.db.tenant.findFirst({
      where: { id, status: { not: 'deleted' } },
    });
  }

  async listForBackoffice({ skip, take, q, status }: BackofficeTenantListQuery) {
    const trimmed = q?.trim();
    const where: Prisma.TenantWhereInput = {
      status: status ?? { not: 'deleted' },
      ...(trimmed
        ? {
            OR: [
              { name: { contains: trimmed, mode: 'insensitive' } },
              { slug: { contains: trimmed, mode: 'insensitive' } },
              {
                memberships: {
                  some: {
                    role: 'owner',
                    deletedAt: null,
                    user: { email: { contains: trimmed, mode: 'insensitive' } },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.tenant.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          timezone: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { memberships: true, dataSources: true, sales: true, insights: true },
          },
        },
      }),
      this.db.tenant.count({ where }),
    ]);

    return { items, total };
  }

  async findBySlug(slug: string) {
    return this.db.tenant.findUnique({ where: { slug } });
  }

  async listByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.db.tenant.findMany({
      where: { id: { in: ids }, status: { not: 'deleted' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listActive() {
    return this.db.tenant.findMany({
      where: { status: 'active' },
      select: { id: true, timezone: true, currency: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update({
    tenantId,
    data,
  }: {
    tenantId: string;
    data: { name?: string; timezone?: string; currency?: string; status?: TenantStatus };
  }) {
    return this.db.tenant.update({
      where: { id: tenantId },
      data,
    });
  }
}

export type TenantRecord = Prisma.TenantGetPayload<object>;
