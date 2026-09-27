import { createApiHandler, readJson } from '@/lib/api';
import { getTenantWhatsappConfig, updateTenantWhatsappConfig } from '@/lib/tenant-whatsapp';

export const GET = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  getTenantWhatsappConfig(ctx, params['id']!),
);

export const PUT = createApiHandler({ auth: 'operator' }, async (request, ctx, params) =>
  updateTenantWhatsappConfig(ctx, params['id']!, await readJson(request)),
);
