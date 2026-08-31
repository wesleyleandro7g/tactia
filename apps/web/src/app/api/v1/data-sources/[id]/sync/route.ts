import { createApiHandler } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { syncService } from '@/lib/services';

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'], rateLimit: RATE_LIMITS.sync },
  async (_request, ctx, params) => {
    return syncService.startSync(ctx, params.id ?? '');
  },
);
