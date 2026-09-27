import { createApiHandler, readJson } from '@/lib/api';
import { sendTenantTestEmail } from '@/lib/tenant-email';

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) =>
  sendTenantTestEmail(ctx, params['id']!, await readJson(request)),
);
