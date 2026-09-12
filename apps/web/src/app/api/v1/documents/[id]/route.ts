import { createApiHandler } from '@/lib/api';
import { knowledgeDocumentService } from '@/lib/services';

export const runtime = 'nodejs';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return knowledgeDocumentService.get(ctx, params.id ?? '');
});

export const DELETE = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (_request, ctx, params) => {
    return knowledgeDocumentService.remove(ctx, params.id ?? '');
  },
);
