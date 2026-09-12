import { createApiHandler, readJson } from '@/lib/api';
import { whatsappAuthorizedNumberService } from '@/lib/services';

export const PATCH = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) => {
    const body = await readJson(request);
    return whatsappAuthorizedNumberService.update(ctx, params.id ?? '', body);
  },
);

export const DELETE = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (_request, ctx, params) => {
    return whatsappAuthorizedNumberService.disable(ctx, params.id ?? '');
  },
);
