import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.sync },
  async (request, ctx, params) => {
    const body = (await readJson(request)) as { dataSourceId?: string };
    return backofficeService.triggerSync(ctx, params['id'] ?? '', String(body.dataSourceId ?? ''));
  },
);
