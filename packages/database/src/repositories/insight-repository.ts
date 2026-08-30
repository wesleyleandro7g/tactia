import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type CreateInsightInput = {
  tenantId: string;
  type: 'anomaly' | 'performance' | 'opportunity' | 'warning';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  ruleKey: string;
  evidence: unknown;
  periodFrom: Date;
  periodTo: Date;
};

export type UpdateInsightInput = {
  status?: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  resolvedAt?: Date | null;
};

export class InsightRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateInsightInput) {
    return this.db.insight.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        type: input.type,
        severity: input.severity,
        title: input.title,
        description: input.description,
        ruleKey: input.ruleKey,
        evidence: input.evidence as never,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.insight.findFirst({
      where: { id, tenantId },
      include: { recommendations: true },
    });
  }

  /** Find an open/acknowledged insight for the same rule+period (deduplication) */
  async findOpenByRuleAndPeriod({
    tenantId,
    ruleKey,
    periodFrom,
    periodTo,
  }: {
    tenantId: string;
    ruleKey: string;
    periodFrom: Date;
    periodTo: Date;
  }) {
    return this.db.insight.findFirst({
      where: {
        tenantId,
        ruleKey,
        periodFrom,
        periodTo,
        status: { in: ['open', 'acknowledged'] },
      },
    });
  }

  async update({ id, tenantId }: { id: string; tenantId: string }, input: UpdateInsightInput) {
    return this.db.insight.update({
      where: { id, tenantId },
      data: input,
    });
  }

  async list({
    tenantId,
    status,
    page = 1,
    pageSize = 20,
  }: {
    tenantId: string;
    status?: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
    page?: number;
    pageSize?: number;
  }) {
    const where = { tenantId, ...(status ? { status } : {}) };
    const [total, items] = await Promise.all([
      this.db.insight.count({ where }),
      this.db.insight.findMany({
        where,
        include: { recommendations: true },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, items, page, pageSize };
  }
}
