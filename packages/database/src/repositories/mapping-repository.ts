import { createId } from '@tactia/shared';
import type { PrismaClient, Prisma } from '../client';
import { asJson } from '../json';

export type CreateMappingInput = {
  tenantId: string;
  dataSourceId: string;
  sourceEntity: string;
  targetEntity: string;
  configuration: Record<string, unknown>;
};

export class MappingRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateMappingInput) {
    return this.db.mapping.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        sourceEntity: input.sourceEntity,
        targetEntity: input.targetEntity,
        configuration: asJson(input.configuration) as Prisma.InputJsonValue,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.mapping.findFirst({ where: { id, tenantId } });
  }

  async findByDataSource({
    tenantId,
    dataSourceId,
    targetEntity,
    activeOnly = true,
  }: {
    tenantId: string;
    dataSourceId: string;
    targetEntity?: string;
    activeOnly?: boolean;
  }) {
    return this.db.mapping.findMany({
      where: {
        tenantId,
        dataSourceId,
        ...(targetEntity ? { targetEntity } : {}),
        ...(activeOnly ? { active: true } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async list({ tenantId, dataSourceId, skip, take }: { tenantId: string; dataSourceId: string; skip: number; take: number }) {
    const where = { tenantId, dataSourceId };
    const [items, total] = await Promise.all([
      this.db.mapping.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.mapping.count({ where }),
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
      sourceEntity?: string;
      targetEntity?: string;
      configuration?: Record<string, unknown>;
      active?: boolean;
    };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.mapping.update({
      where: { id },
      data: {
        sourceEntity: data.sourceEntity,
        targetEntity: data.targetEntity,
        configuration: data.configuration ? asJson(data.configuration) : undefined,
        active: data.active,
        version: { increment: 1 },
      },
    });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.mapping.delete({ where: { id } });
  }
}
