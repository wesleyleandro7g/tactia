import { createApiHandler } from '@/lib/api';
import { browserAutomationService } from '@/lib/browser-automation';

export const POST = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return browserAutomationService.cancelTask(ctx, params['id']!);
});
