import { createApiHandler, readJson } from '@/lib/api';
import { tenantApiKeyService } from '@/lib/services';

export const GET = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (_request, ctx) => tenantApiKeyService.list(ctx),
);

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => {
    const body = await readJson(request);
    return tenantApiKeyService.create(ctx, body);
  },
);
