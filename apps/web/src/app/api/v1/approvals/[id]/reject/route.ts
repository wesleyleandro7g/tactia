import { createApiHandler, readJson } from '@/lib/api';
import { chatServices, commandCenterService } from '@/lib/services';

/**
 * POST /api/v1/approvals/:id/reject
 * Body: { reason? }
 * Rejects the request — the execution is cancelled and never runs. Legacy
 * Browser Agent approvals also retire their task.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) => {
    const approvalId = params['id']!;
    const body = await readJson(request).catch(() => ({}));
    const decision = await commandCenterService.assertDecisionCurrent(ctx, approvalId);
    const execution = await chatServices.rejectApproval(ctx, approvalId, body ?? {});
    const plan = await commandCenterService.reconcileExecution(ctx, execution.id);
    return { ...execution, decisionContext: decision, plan };
  },
);
