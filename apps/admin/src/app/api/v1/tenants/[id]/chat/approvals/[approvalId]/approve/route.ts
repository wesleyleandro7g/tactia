import { createApiHandler, readJson } from '@/lib/api';
import { chatServices, chatTenantContext } from '@/lib/chat';
import { commandCenterService } from '@/lib/services';
import { RATE_LIMITS } from '@/lib/rate-limit';

/**
 * POST /api/v1/tenants/:id/chat/approvals/:approvalId/approve
 * Approves and runs the execution for real in the tenant (audited as operator).
 */
export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    const tenantCtx = await chatTenantContext(ctx, params['id']!);
    const approvalId = params['approvalId']!;
    const body = await readJson(request).catch(() => ({}));
    const decision = await commandCenterService.assertDecisionCurrent(tenantCtx, approvalId);
    const execution = await chatServices.approvalService.approve(
      tenantCtx,
      approvalId,
      body ?? {},
    );
    if (decision) await commandCenterService.recordApprovalDecision(tenantCtx, approvalId, 'approved');
    const plan = await commandCenterService.reconcileExecution(tenantCtx, execution.id);
    return { ...execution, decisionContext: decision, plan };
  },
);
