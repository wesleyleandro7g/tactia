import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { metricService } from '@/lib/services';

/**
 * GET /api/v1/metrics
 * Returns metric definitions + bulk calculation.
 *
 * Query params:
 *   from, to (ISO dates)
 *   withComparison (boolean string)
 *   breakdownDimension (product | seller | time)
 *   breakdownGranularity (day | week | month)
 *   keys (comma-separated metric keys)
 *   mode=definitions — only return definitions, no calculation
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  const params = searchParamsRecord(request);

  if (params['mode'] === 'definitions') {
    return { definitions: metricService.listDefinitions(ctx) };
  }

  return metricService.calculateBulk(ctx, params);
});
