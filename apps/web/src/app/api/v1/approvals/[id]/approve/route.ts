import { createApiHandler, readJson } from '@/lib/api';
import { approvalService } from '@/lib/services';

/**
 * POST /api/v1/approvals/:id/approve
 * Body: { reason? }
 * Approves the request and runs the execution — returns the updated record
 * with output or error already filled in.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) => {
    const body = await readJson(request).catch(() => ({}));
    return approvalService.approve(ctx, params['id']!, body ?? {});
  },
);
