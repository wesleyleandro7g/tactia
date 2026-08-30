import { createApiHandler } from '@/lib/api';
import { syncService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return syncService.getSyncJob(ctx, params.id ?? '');
});
