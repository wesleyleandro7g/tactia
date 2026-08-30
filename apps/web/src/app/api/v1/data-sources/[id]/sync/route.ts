import { createApiHandler } from '@/lib/api';
import { syncService } from '@/lib/services';

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (_request, ctx, params) => {
    return syncService.startSync(ctx, params.id ?? '');
  },
);
