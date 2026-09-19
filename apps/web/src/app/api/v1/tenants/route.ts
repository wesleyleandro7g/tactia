import { createApiHandler } from '@/lib/api';
import { administrativeRegistrationOnly } from '@/lib/registration-policy';
import { tenantService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'user' }, async (_request, ctx) => {
  return tenantService.listForUser(ctx);
});

export const POST = administrativeRegistrationOnly;
