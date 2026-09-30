import { createApiHandler } from '@/lib/api';
import { automationService } from '@/lib/automations';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx) => automationService.list(ctx));
