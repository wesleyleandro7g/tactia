import { createApiHandler } from '@/lib/api';
import { actionService } from '@/lib/services';

/**
 * GET /api/v1/action-executions/:id
 * Full record: input, output, error, timestamps, action and approvals.
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return actionService.getExecution(ctx, params['id']!);
});
