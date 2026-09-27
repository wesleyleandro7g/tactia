import { createApiHandler, readJson } from '@/lib/api';
import { createTenantWhatsappNumber, listTenantWhatsappNumbers } from '@/lib/tenant-whatsapp';

export const GET = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  listTenantWhatsappNumbers(ctx, params['id']!),
);

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) =>
  createTenantWhatsappNumber(ctx, params['id']!, await readJson(request)),
);
