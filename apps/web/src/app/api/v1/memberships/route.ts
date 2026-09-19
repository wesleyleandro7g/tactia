import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { administrativeRegistrationOnly } from '@/lib/registration-policy';
import { membershipService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return membershipService.list(ctx, searchParamsRecord(request));
});

export const POST = administrativeRegistrationOnly;
