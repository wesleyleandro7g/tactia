import { createApiHandler } from '@/lib/api';
import { operatorService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx) => {
  return operatorService.getMe(ctx);
});
