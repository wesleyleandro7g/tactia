import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type CreateGoalInput = {
  tenantId: string;
  scope?: string;
  scopeId?: string | null;
  metricKey: string;
  periodType: string;
  periodStart: Date;
  target: number;
};

export class GoalRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateGoalInput) {
    return this.db.goal.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        scope: input.scope ?? 'tenant',
        scopeId: input.scopeId ?? null,
        metricKey: input.metricKey,
        periodType: input.periodType,
        periodStart: input.periodStart,
        target: input.target,
      },
    });
  }

  async list(tenantId: string) {
    return this.db.goal.findMany({
      where: { tenantId },
      orderBy: { periodStart: 'desc' },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.goal.findFirst({ where: { id, tenantId } });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.goal.delete({ where: { id } });
    return existing;
  }
}
