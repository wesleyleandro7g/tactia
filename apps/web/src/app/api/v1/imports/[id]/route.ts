import { createApiHandler } from '@/lib/api';
import { importService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return importService.get(ctx, params.id ?? '');
});
