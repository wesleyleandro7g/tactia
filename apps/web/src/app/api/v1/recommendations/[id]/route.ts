import { createApiHandler } from '@/lib/api';
import { recommendationService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return recommendationService.getById(ctx, params['id']!);
});
