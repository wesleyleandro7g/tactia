import { createApiHandler } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { companyKnowledgeService } from '@/lib/services';

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'], rateLimit: RATE_LIMITS.chat },
  async (_request, ctx) => companyKnowledgeService.suggestProfile(ctx),
);
