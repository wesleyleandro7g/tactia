import { createApiHandler } from '@/lib/api';
import { chatServices, chatTenantContext } from '@/lib/chat';
import { RATE_LIMITS } from '@/lib/rate-limit';

/** POST /api/v1/tenants/:id/chat/browser/tasks/:taskId/cancel — durable stop. */
export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (_request, ctx, params) => {
    const tenantCtx = await chatTenantContext(ctx, params['id']!);
    return chatServices.browserAutomationService.cancelTask(tenantCtx, params['taskId']!);
  },
);
