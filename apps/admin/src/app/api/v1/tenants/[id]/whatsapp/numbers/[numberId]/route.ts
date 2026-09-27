import { createApiHandler, readJson } from '@/lib/api';
import { disableTenantWhatsappNumber, updateTenantWhatsappNumber } from '@/lib/tenant-whatsapp';

export const PATCH = createApiHandler({ auth: 'operator' }, async (request, ctx, params) =>
  updateTenantWhatsappNumber(ctx, params['id']!, params['numberId']!, await readJson(request)),
);

export const DELETE = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  disableTenantWhatsappNumber(ctx, params['id']!, params['numberId']!),
);
