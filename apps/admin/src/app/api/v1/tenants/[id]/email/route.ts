import { createApiHandler, readJson } from '@/lib/api';
import {
  deleteTenantEmailConfig,
  getTenantEmailConfig,
  saveTenantEmailConfig,
} from '@/lib/tenant-email';

export const GET = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  getTenantEmailConfig(ctx, params['id']!),
);

export const PUT = createApiHandler({ auth: 'operator' }, async (request, ctx, params) =>
  saveTenantEmailConfig(ctx, params['id']!, await readJson(request)),
);

export const DELETE = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  deleteTenantEmailConfig(ctx, params['id']!),
);
