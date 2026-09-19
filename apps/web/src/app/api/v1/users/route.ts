import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { administrativeRegistrationOnly } from '@/lib/registration-policy';
import { userService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return userService.list(ctx, searchParamsRecord(request));
});

export const POST = administrativeRegistrationOnly;
