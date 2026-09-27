import { createApiHandler, readJson } from '@/lib/api';
import { whatsappAgentConfigService } from '@/lib/services';

export const GET = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (_request, ctx) => whatsappAgentConfigService.get(ctx),
);

export const PUT = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => {
    const body = await readJson(request);
    return whatsappAgentConfigService.upsert(ctx, body);
  },
);
