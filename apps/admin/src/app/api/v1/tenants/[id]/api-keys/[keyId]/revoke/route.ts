import { createApiHandler } from '@/lib/api';
import { revokeTenantApiKey } from '@/lib/tenant-api-keys';

export const POST = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  revokeTenantApiKey(ctx, params['id']!, params['keyId']!),
);
