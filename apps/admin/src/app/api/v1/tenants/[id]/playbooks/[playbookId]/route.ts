import { createApiHandler, readJson } from '@/lib/api';
import { removeTenantPlaybook, updateTenantPlaybook } from '@/lib/tenant-playbooks';

export const PATCH = createApiHandler({ auth: 'operator' }, async (request, ctx, params) =>
  updateTenantPlaybook(ctx, params['id']!, params['playbookId']!, await readJson(request)),
);

export const DELETE = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  removeTenantPlaybook(ctx, params['id']!, params['playbookId']!),
);
