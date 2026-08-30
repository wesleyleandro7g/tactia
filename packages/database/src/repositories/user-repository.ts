import { createId } from '@tactia/shared';
import type { Prisma, PrismaClient } from '../client';

export type CreateUserInput = {
  externalAuthId: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
};

export class UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateUserInput) {
    return this.db.user.create({
      data: {
        id: createId(),
        externalAuthId: input.externalAuthId,
        name: input.name,
        email: input.email,
        avatarUrl: input.avatarUrl ?? null,
      },
    });
  }

  async findByExternalAuthId(externalAuthId: string) {
    return this.db.user.findFirst({
      where: { externalAuthId, deletedAt: null },
    });
  }

  async findByEmail(email: string) {
    return this.db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    });
  }

  async findByDomainId(id: string) {
    return this.db.user.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.user.findFirst({
      where: {
        id,
        deletedAt: null,
        memberships: {
          some: { tenantId, deletedAt: null, status: { not: 'removed' } },
        },
      },
    });
  }

  async listByTenant({
    tenantId,
    skip,
    take,
  }: {
    tenantId: string;
    skip: number;
    take: number;
  }) {
    const where = {
      deletedAt: null,
      memberships: { some: { tenantId, deletedAt: null, status: { not: 'removed' as const } } },
    };

    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.user.count({ where }),
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
    data: { name?: string; avatarUrl?: string | null };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.user.update({ where: { id }, data });
  }

  async softDelete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

export type UserRecord = Prisma.UserGetPayload<object>;
