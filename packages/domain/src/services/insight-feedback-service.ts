import { z } from 'zod';
import type { InsightFeedbackRepository, InsightRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertTenantContext } from '../authz';

export const upsertInsightFeedbackSchema = z.object({
  useful: z.boolean(),
  reason: z.string().trim().max(400).nullable().optional(),
});

export class InsightFeedbackService {
  constructor(
    private readonly feedback: InsightFeedbackRepository,
    private readonly insights: InsightRepository,
  ) {}

  async upsert(ctx: RequestContext, insightId: string, raw: unknown) {
    assertTenantContext(ctx);
    const input = upsertInsightFeedbackSchema.parse(raw);
    const insight = await this.insights.findById({ tenantId: ctx.tenantId, id: insightId });
    if (!insight) throw new AppError(ErrorCode.NOT_FOUND, 'Insight not found');
    if (!ctx.userId) throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'A signed-in user is required');
    return this.feedback.upsert({
      tenantId: ctx.tenantId,
      insightId,
      userId: ctx.userId,
      useful: input.useful,
      reason: input.reason,
    });
  }
}
