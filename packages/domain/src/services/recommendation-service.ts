import { z } from 'zod';
import type { RecommendationRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertTenantContext } from '../authz';
import type { AuditLogService } from './audit-log-service';
import { AuditAction } from './audit-log-service';

export const listRecommendationsQuerySchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'dismissed']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export class RecommendationService {
  constructor(
    private readonly recommendations: RecommendationRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listRecommendationsQuerySchema.parse(query);
    return this.recommendations.list({ tenantId: ctx.tenantId, ...parsed });
  }

  async getById(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const rec = await this.recommendations.findById({ tenantId: ctx.tenantId, id });
    if (!rec) throw new AppError(ErrorCode.NOT_FOUND, 'Recommendation not found');
    return rec;
  }

  async accept(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const rec = await this.recommendations.findById({ tenantId: ctx.tenantId, id });
    if (!rec) throw new AppError(ErrorCode.NOT_FOUND, 'Recommendation not found');
    if (rec.status !== 'pending') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Recommendation is already ${rec.status}`);
    }

    const updated = await this.recommendations.update(
      { id, tenantId: ctx.tenantId },
      { status: 'accepted', acceptedAt: new Date() },
    );

    await this.auditLogs.record(ctx, {
      action: AuditAction.RECOMMENDATION_ACCEPTED,
      entityType: 'recommendation',
      entityId: id,
    });

    return updated;
  }

  async reject(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const rec = await this.recommendations.findById({ tenantId: ctx.tenantId, id });
    if (!rec) throw new AppError(ErrorCode.NOT_FOUND, 'Recommendation not found');
    if (rec.status !== 'pending') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Recommendation is already ${rec.status}`);
    }

    return this.recommendations.update(
      { id, tenantId: ctx.tenantId },
      { status: 'rejected', rejectedAt: new Date() },
    );
  }

  async dismiss(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const rec = await this.recommendations.findById({ tenantId: ctx.tenantId, id });
    if (!rec) throw new AppError(ErrorCode.NOT_FOUND, 'Recommendation not found');
    if (rec.status !== 'pending') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Recommendation is already ${rec.status}`);
    }

    return this.recommendations.update({ id, tenantId: ctx.tenantId }, { status: 'dismissed' });
  }
}
