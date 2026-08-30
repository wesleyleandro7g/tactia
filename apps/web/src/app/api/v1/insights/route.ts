import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { insightService } from '@/lib/services';

/**
 * GET /api/v1/insights
 * Query: status, page, pageSize
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return insightService.list(ctx, searchParamsRecord(request));
});

/**
 * POST /api/v1/insights/run-pipeline
 * Trigger the intelligence pipeline on-demand.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx) => {
    const { intelligencePipelineService } = await import('@/lib/services');
    const body = (await readJson(request)) as Record<string, unknown> | null;
    return intelligencePipelineService.run({
      tenantId: ctx.tenantId!,
      periodFrom: body?.periodFrom ? new Date(body.periodFrom as string) : undefined,
      periodTo: body?.periodTo ? new Date(body.periodTo as string) : undefined,
      actorCtx: { tenantId: ctx.tenantId, userId: ctx.userId, ip: ctx.ip },
    });
  },
);
