import { createApiHandler, readJson } from '@/lib/api';
import { metricService } from '@/lib/services';

/**
 * POST /api/v1/metrics/:key/calculate
 * Body: { period: { from, to }, withComparison?, breakdown? }
 */
export const POST = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  const { params } = request as unknown as { params: Promise<{ key: string }> };
  const { key } = await params;
  const body = await readJson(request);
  return metricService.calculate(ctx, key, body);
});
