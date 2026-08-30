import { createId } from '@tactia/shared';
import { Prisma, type ActivityType, type PrismaClient } from '../client';
import { asJson, asNullableJson } from '../json';

export type CreateActivityInput = {
  tenantId: string;
  type: ActivityType;
  customerId?: string | null;
  leadId?: string | null;
  sellerId?: string | null;
  occurredAt: Date;
  metadata?: unknown;
};

export class ActivityRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateActivityInput) {
    return this.db.activity.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        type: input.type,
        customerId: input.customerId ?? null,
        leadId: input.leadId ?? null,
        sellerId: input.sellerId ?? null,
        occurredAt: input.occurredAt,
        metadata: asJson(input.metadata),
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.activity.findFirst({ where: { id, tenantId } });
  }

  async list({
    tenantId,
    skip,
    take,
    type,
    customerId,
    leadId,
    sellerId,
  }: {
    tenantId: string;
    skip: number;
    take: number;
    type?: ActivityType;
    customerId?: string;
    leadId?: string;
    sellerId?: string;
  }) {
    const where: Prisma.ActivityWhereInput = {
      tenantId,
      ...(type ? { type } : {}),
      ...(customerId ? { customerId } : {}),
      ...(leadId ? { leadId } : {}),
      ...(sellerId ? { sellerId } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.activity.findMany({ where, skip, take, orderBy: { occurredAt: 'desc' } }),
      this.db.activity.count({ where }),
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
      type?: ActivityType;
      customerId?: string | null;
      leadId?: string | null;
      sellerId?: string | null;
      occurredAt?: Date;
      metadata?: unknown;
    };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.activity.update({
      where: { id },
      data: {
        type: data.type,
        customerId: data.customerId,
        leadId: data.leadId,
        sellerId: data.sellerId,
        occurredAt: data.occurredAt,
        metadata: asNullableJson(data.metadata),
      },
    });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.activity.delete({ where: { id } });
    return existing;
  }
}
