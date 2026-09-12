import { createApiHandler } from '@/lib/api';
import { businessFactService } from '@/lib/services';

export const DELETE = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (_request, ctx, params) => {
    return businessFactService.remove(ctx, params.id ?? '');
  },
);
