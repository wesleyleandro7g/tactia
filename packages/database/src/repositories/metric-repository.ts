import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type CreateMetricInput = {
  tenantId: string;
  key: string;
  name: string;
  description?: string;
  definition: unknown;
};

export class MetricRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsert(input: CreateMetricInput) {
    return this.db.metric.upsert({
      where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
      update: {
        name: input.name,
        description: input.description,
        definition: input.definition as never,
      },
      create: {
        id: createId(),
        tenantId: input.tenantId,
        key: input.key,
        name: input.name,
        description: input.description,
        definition: input.definition as never,
      },
    });
  }

  async findByKey({ tenantId, key }: { tenantId: string; key: string }) {
    return this.db.metric.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
  }

  async listByTenant({ tenantId }: { tenantId: string }) {
    return this.db.metric.findMany({
      where: { tenantId },
      orderBy: { key: 'asc' },
    });
  }
}
