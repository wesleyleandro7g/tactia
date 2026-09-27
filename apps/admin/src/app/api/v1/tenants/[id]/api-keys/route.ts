import { createApiHandler, readJson } from '@/lib/api';
import { createTenantApiKey, listTenantApiKeys } from '@/lib/tenant-api-keys';

export const GET = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  listTenantApiKeys(ctx, params['id']!),
);

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) =>
  createTenantApiKey(ctx, params['id']!, await readJson(request)),
);
