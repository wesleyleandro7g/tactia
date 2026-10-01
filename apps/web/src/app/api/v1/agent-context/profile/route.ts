import { createApiHandler, readJson } from '@/lib/api';
import { companyKnowledgeService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx) =>
  companyKnowledgeService.profile(ctx));

export const PUT = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => companyKnowledgeService.saveProfile(ctx, await readJson(request)),
);
