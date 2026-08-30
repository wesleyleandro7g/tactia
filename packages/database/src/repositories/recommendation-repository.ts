import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type CreateRecommendationInput = {
  tenantId: string;
  insightId: string;
  priority: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  actionType?: string;
  metadata?: unknown;
};

export class RecommendationRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateRecommendationInput) {
    return this.db.recommendation.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        insightId: input.insightId,
        priority: input.priority,
        title: input.title,
        description: input.description,
        actionType: input.actionType,
        metadata: input.metadata as never,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.recommendation.findFirst({
      where: { id, tenantId },
      include: { insight: true },
    });
  }

  async findPendingByInsight({ insightId }: { insightId: string }) {
    return this.db.recommendation.findFirst({
      where: { insightId, status: 'pending' },
    });
  }

  async update(
    { id, tenantId }: { id: string; tenantId: string },
    input: {
      status?: 'pending' | 'accepted' | 'rejected' | 'dismissed';
      acceptedAt?: Date | null;
      rejectedAt?: Date | null;
    },
  ) {
    return this.db.recommendation.update({
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
    status?: 'pending' | 'accepted' | 'rejected' | 'dismissed';
    page?: number;
    pageSize?: number;
  }) {
    const where = { tenantId, ...(status ? { status } : {}) };
    const [total, items] = await Promise.all([
      this.db.recommendation.count({ where }),
      this.db.recommendation.findMany({
        where,
        include: { insight: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, items, page, pageSize };
  }
}
