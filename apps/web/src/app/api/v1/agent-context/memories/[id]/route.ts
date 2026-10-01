import { createApiHandler, readJson } from '@/lib/api';
import { companyKnowledgeService } from '@/lib/services';

export const PATCH = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) => companyKnowledgeService.editSummary(ctx, params.id ?? '', await readJson(request)),
);

export const DELETE = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (_request, ctx, params) => companyKnowledgeService.deleteSummary(ctx, params.id ?? ''),
);
