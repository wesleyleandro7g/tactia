import { createApiHandler, readJson } from '@/lib/api';
import { chatServices } from '@/lib/services';

/**
 * POST /api/v1/approvals/:id/reject
 * Body: { reason? }
 * Rejects the request — the execution is cancelled and never runs. Legacy
 * Browser Agent approvals also retire their task.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) => {
    const body = await readJson(request).catch(() => ({}));
    return chatServices.rejectApproval(ctx, params['id']!, body ?? {});
  },
);
