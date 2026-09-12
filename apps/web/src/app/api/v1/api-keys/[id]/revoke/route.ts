import { createApiHandler } from '@/lib/api';
import { tenantApiKeyService } from '@/lib/services';

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (_request, ctx, params) => tenantApiKeyService.revoke(ctx, params.id ?? ''),
);
