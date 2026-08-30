import { createId } from '@tactia/shared';
import type { MembershipRole, MembershipStatus } from '@tactia/shared';
import type { Prisma, PrismaClient } from '../client';

export type CreateMembershipInput = {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  status?: MembershipStatus;
};

export class MembershipRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateMembershipInput) {
    return this.db.membership.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role,
        status: input.status ?? 'active',
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.membership.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { user: true },
    });
  }

  async findByUserAndTenant({ tenantId, userId }: { tenantId: string; userId: string }) {
    return this.db.membership.findFirst({
      where: {
        tenantId,
        userId,
        deletedAt: null,
        status: { not: 'removed' },
      },
    });
  }

  async listByUserId(userId: string) {
    return this.db.membership.findMany({
      where: { userId, deletedAt: null, status: 'active' },
      include: { tenant: true },
      orderBy: { createdAt: 'desc' },
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
    const where = { tenantId, deletedAt: null, status: { not: 'removed' as const } };
    const [items, total] = await Promise.all([
      this.db.membership.findMany({
        where,
        skip,
        take,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.membership.count({ where }),
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
    data: { role?: MembershipRole; status?: MembershipStatus };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.membership.update({
      where: { id },
      data,
      include: { user: true },
    });
  }

  async softDelete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.membership.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'removed' },
    });
  }
}

export type MembershipRecord = Prisma.MembershipGetPayload<{ include: { user: true } }>;
