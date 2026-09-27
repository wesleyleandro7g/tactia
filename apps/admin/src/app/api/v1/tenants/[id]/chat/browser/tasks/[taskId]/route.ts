import { createApiHandler } from '@/lib/api';
import { chatServices, chatTenantContext } from '@/lib/chat';

/** GET /api/v1/tenants/:id/chat/browser/tasks/:taskId — Browser Agent card polling. */
export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  const tenantCtx = await chatTenantContext(ctx, params['id']!);
  return chatServices.browserAutomationService.getTask(tenantCtx, params['taskId']!);
});
