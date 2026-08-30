import { createApiHandler } from '@/lib/api';
import { recommendationService } from '@/lib/services';

export const POST = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return recommendationService.dismiss(ctx, params['id']!);
});
