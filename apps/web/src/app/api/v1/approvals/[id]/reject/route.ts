import { createApiHandler, readJson } from '@/lib/api';
import { approvalService } from '@/lib/services';

/**
 * POST /api/v1/approvals/:id/reject
 * Body: { reason? }
 * Rejects the request — the execution is cancelled and never runs.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) => {
    const body = await readJson(request).catch(() => ({}));
    return approvalService.reject(ctx, params['id']!, body ?? {});
  },
);
