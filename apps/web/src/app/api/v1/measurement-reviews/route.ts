import { createApiHandler, readJson } from '@/lib/api';
import { commandCenterService } from '@/lib/services';

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => commandCenterService.createReview(ctx, await readJson(request)),
);
