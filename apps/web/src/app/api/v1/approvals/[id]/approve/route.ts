import { createApiHandler, readJson } from '@/lib/api';
import { approvalService, commandCenterService } from '@/lib/services';

/**
 * POST /api/v1/approvals/:id/approve
 * Body: { reason? }
 * Approves the request and runs the execution — returns the updated record
 * with output or error already filled in.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) => {
    const approvalId = params['id']!;
    const body = await readJson(request).catch(() => ({}));
    const decision = await commandCenterService.assertDecisionCurrent(ctx, approvalId);
    const execution = await approvalService.approve(ctx, approvalId, body ?? {});
    const plan = await commandCenterService.reconcileExecution(ctx, execution.id);
    return { ...execution, decisionContext: decision, plan };
  },
);
