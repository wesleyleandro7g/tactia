import { createApiHandler } from '@/lib/api';
import { automationService } from '@/lib/automations';

export const POST = createApiHandler({ auth: 'tenant', roles: ['member', 'admin', 'owner'] }, async (_request, ctx, params) =>
  automationService.cancel(ctx, params['id']!, params['runId']!),
);
