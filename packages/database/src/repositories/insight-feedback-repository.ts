import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type UpsertInsightFeedbackInput = {
  tenantId: string;
  insightId: string;
  userId: string;
  useful: boolean;
  reason?: string | null;
};

export class InsightFeedbackRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsert(input: UpsertInsightFeedbackInput) {
    return this.db.insightFeedback.upsert({
      where: {
        insightId_userId: { insightId: input.insightId, userId: input.userId },
      },
      update: {
        useful: input.useful,
        reason: input.reason ?? null,
      },
      create: {
        id: createId(),
        tenantId: input.tenantId,
        insightId: input.insightId,
        userId: input.userId,
        useful: input.useful,
        reason: input.reason ?? null,
      },
    });
  }

  async countByRuleDismissals({ tenantId, since }: { tenantId: string; since?: Date }) {
    const rows = await this.countByRuleVerdict({ tenantId, since });
    return rows.filter((row) => row.noise > 0).map((row) => ({ ruleKey: row.ruleKey, count: row.noise }));
  }

  async countByRuleVerdict({ tenantId, since }: { tenantId: string; since?: Date }) {
    const rows = await this.db.insightFeedback.findMany({
      where: {
        tenantId,
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      select: { useful: true, insight: { select: { ruleKey: true } } },
    });
    const counts = new Map<string, { useful: number; noise: number }>();
    for (const row of rows) {
      const key = row.insight.ruleKey;
      const current = counts.get(key) ?? { useful: 0, noise: 0 };
      if (row.useful) current.useful += 1;
      else current.noise += 1;
      counts.set(key, current);
    }
    return [...counts.entries()].map(([ruleKey, value]) => ({ ruleKey, ...value }));
  }
}
