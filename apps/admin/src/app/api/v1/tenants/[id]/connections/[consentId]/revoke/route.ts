import { createApiHandler } from '@/lib/api';
import { revokeTenantConnection } from '@/lib/tenant-connections';

export const POST = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  revokeTenantConnection(ctx, params['id']!, params['consentId']!),
);
