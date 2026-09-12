import { createId } from '@tactia/shared';
import type { Prisma, PrismaClient, TenantStatus } from '../client';

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
