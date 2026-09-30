import { createApiHandler } from '@/lib/api';
import { automationService } from '@/lib/automations';
import { operatorTenantContext } from '@/lib/operator-tenant';

export const POST = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) =>
  automationService.pause(operatorTenantContext(ctx, params['id']!), params['automationId']!),
);
