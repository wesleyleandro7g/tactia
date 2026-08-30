import { createApiHandler, readJson } from '@/lib/api';
import { executionEngine } from '@/lib/services';

/**
 * POST /api/v1/action-executions/:id/cancel
 * Body: { reason? }
 * Only executions that have not run yet (pending, awaiting_approval, approved).
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx, params) => {
    const body = (await readJson(request).catch(() => ({}))) as { reason?: string } | null;
    return executionEngine.cancel(ctx, params['id']!, body?.reason ?? null);
  },
);
