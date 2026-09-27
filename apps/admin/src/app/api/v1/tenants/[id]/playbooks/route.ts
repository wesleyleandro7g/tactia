import { createApiHandler, readJson } from '@/lib/api';
import { createTenantPlaybook, listTenantPlaybooks } from '@/lib/tenant-playbooks';

export const GET = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  listTenantPlaybooks(ctx, params['id']!),
);

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) =>
  createTenantPlaybook(ctx, params['id']!, await readJson(request)),
);
