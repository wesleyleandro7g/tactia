import { createApiHandler, readJson } from '@/lib/api';
import { chatServices, chatTenantContext } from '@/lib/chat';
import { RATE_LIMITS } from '@/lib/rate-limit';

/** POST /api/v1/tenants/:id/chat/approvals/:approvalId/reject — cancels the execution. */
export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    const tenantCtx = await chatTenantContext(ctx, params['id']!);
    const body = await readJson(request).catch(() => ({}));
    return chatServices.rejectApproval(tenantCtx, params['approvalId']!, body ?? {});
  },
);
