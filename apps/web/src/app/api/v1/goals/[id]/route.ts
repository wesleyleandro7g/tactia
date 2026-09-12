import { createApiHandler } from '@/lib/api';
import { goalService } from '@/lib/services';

export const DELETE = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (_request, ctx, params) => {
    return goalService.remove(ctx, params.id ?? '');
  },
);
