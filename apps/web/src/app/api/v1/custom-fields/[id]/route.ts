import { createApiHandler, readJson } from '@/lib/api';
import { customFieldDefinitionService } from '@/lib/services';

export const PATCH = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) => {
    return customFieldDefinitionService.update(ctx, params.id ?? '', await readJson(request));
  },
);

export const DELETE = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (_request, ctx, params) => {
    return customFieldDefinitionService.remove(ctx, params.id ?? '');
  },
);
