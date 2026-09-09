import { createApiHandler } from '@/lib/api';
import { interactionService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return interactionService.get(ctx, params.id ?? '');
});
