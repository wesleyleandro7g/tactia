import { createApiHandler, readJson } from '@/lib/api';
import { whatsappAuthorizedNumberService } from '@/lib/services';

export const GET = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (_request, ctx) => whatsappAuthorizedNumberService.list(ctx),
);

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => {
    const body = await readJson(request);
    return whatsappAuthorizedNumberService.create(ctx, body);
  },
);
