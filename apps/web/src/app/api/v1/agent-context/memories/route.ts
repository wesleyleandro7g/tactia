import { createApiHandler } from '@/lib/api';
import { companyKnowledgeService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx) => ({
  items: await companyKnowledgeService.listSummaries(ctx),
}));
