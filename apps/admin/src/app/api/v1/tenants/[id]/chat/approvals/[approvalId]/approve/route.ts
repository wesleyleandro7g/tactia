import { createApiHandler, readJson } from '@/lib/api';
import { chatServices, chatTenantContext } from '@/lib/chat';
import { RATE_LIMITS } from '@/lib/rate-limit';

/**
 * POST /api/v1/tenants/:id/chat/approvals/:approvalId/approve
 * Approves and runs the execution for real in the tenant (audited as operator).
 */
export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    const tenantCtx = await chatTenantContext(ctx, params['id']!);
    const body = await readJson(request).catch(() => ({}));
    return chatServices.approvalService.approve(tenantCtx, params['approvalId']!, body ?? {});
  },
);
