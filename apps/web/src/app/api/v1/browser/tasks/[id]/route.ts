import { createApiHandler } from '@/lib/api';
import { browserAutomationService } from '@/lib/browser-automation';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return browserAutomationService.getTask(ctx, params['id']!);
});
