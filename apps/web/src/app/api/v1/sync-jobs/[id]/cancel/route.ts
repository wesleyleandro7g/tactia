import { createApiHandler } from '@/lib/api';
import { syncService } from '@/lib/services';

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (_request, ctx, params) => {
    return syncService.cancelSyncJob(ctx, params.id ?? '');
  },
);
