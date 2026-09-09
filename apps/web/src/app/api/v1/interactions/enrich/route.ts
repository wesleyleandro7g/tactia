import { createApiHandler } from '@/lib/api';
import { interactionService } from '@/lib/services';

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (_request, ctx) => {
    return interactionService.enrichPending(ctx);
  },
);
