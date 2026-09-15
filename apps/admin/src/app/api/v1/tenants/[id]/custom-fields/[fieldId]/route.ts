import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';

export const PATCH = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    return backofficeService.updateCustomField(
      ctx,
      params['id'] ?? '',
      params['fieldId'] ?? '',
      await readJson(request),
    );
  },
);

export const DELETE = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (_request, ctx, params) => {
    return backofficeService.deleteCustomField(ctx, params['id'] ?? '', params['fieldId'] ?? '');
  },
);
