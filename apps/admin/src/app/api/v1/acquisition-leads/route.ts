import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { acquisitionLeadService } from '@/lib/acquisition';

export const GET = createApiHandler({ auth: 'operator' }, (request, ctx) =>
  acquisitionLeadService.list(ctx, searchParamsRecord(request)),
);
