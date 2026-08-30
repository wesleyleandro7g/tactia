import type { ApprovalRepository, ApprovalStatus } from '@tactia/database';
import { assertTenantContext } from '@tactia/domain';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import type { ExecutionEngine } from './execution-engine';
import { approvalDecisionSchema, listApprovalsQuerySchema } from './schemas';

/**
 * ApprovalService is the human-in-the-loop surface (spec §3.5): the queue of
 * pending approvals plus the approve/reject decisions, which delegate to the
 * ExecutionEngine so the state machine lives in one place.
 */
export class ApprovalService {
  constructor(
    private readonly approvals: ApprovalRepository,
    private readonly engine: ExecutionEngine,
  ) {}

  /** Defaults to the pending queue — the screen operators actually use. */
  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listApprovalsQuerySchema.parse(query);
    return this.approvals.list({
      tenantId: ctx.tenantId,
      status: (parsed.status ?? 'pending') as ApprovalStatus,
      page: parsed.page,
      pageSize: parsed.pageSize,
    });
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const approval = await this.approvals.findById({ tenantId: ctx.tenantId, id });
    if (!approval) throw new AppError(ErrorCode.NOT_FOUND, 'Approval not found');
    return approval;
  }

  async approve(ctx: RequestContext, id: string, raw?: unknown) {
    const { reason } = approvalDecisionSchema.parse(raw ?? {});
    return this.engine.approve(ctx, id, reason ?? null);
  }

  async reject(ctx: RequestContext, id: string, raw?: unknown) {
    const { reason } = approvalDecisionSchema.parse(raw ?? {});
    return this.engine.reject(ctx, id, reason ?? null);
  }
}
