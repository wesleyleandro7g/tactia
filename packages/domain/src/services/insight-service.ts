import { z } from 'zod';
import type { InsightRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertTenantContext } from '../authz';

export const listInsightsQuerySchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateInsightSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']),
});

export class InsightService {
  constructor(private readonly insights: InsightRepository) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listInsightsQuerySchema.parse(query);
    return this.insights.list({ tenantId: ctx.tenantId, ...parsed });
  }

  async getById(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const insight = await this.insights.findById({ tenantId: ctx.tenantId, id });
    if (!insight) throw new AppError(ErrorCode.NOT_FOUND, 'Insight not found');
    return insight;
  }

  async updateStatus(ctx: RequestContext, id: string, raw: unknown) {
    assertTenantContext(ctx);
    const existing = await this.insights.findById({ tenantId: ctx.tenantId, id });
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'Insight not found');

    const { status } = updateInsightSchema.parse(raw);
    const resolvedAt = status === 'resolved' ? new Date() : null;

    return this.insights.update({ id, tenantId: ctx.tenantId }, { status, resolvedAt });
  }
}
