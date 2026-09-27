import { createApiHandler } from '@/lib/api';
import { removeTenantDocument } from '@/lib/tenant-documents';

export const runtime = 'nodejs';

export const DELETE = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  removeTenantDocument(ctx, params['id']!, params['docId']!),
);
