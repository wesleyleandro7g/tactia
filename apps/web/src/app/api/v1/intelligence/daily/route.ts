import { createId, fail, ok, ErrorCode, REQUEST_ID_HEADER, logger } from '@tactia/shared';
import { cronSecretMatches, enqueueDailyForDueTenants, jobsEnabled, runIntelligenceDaily } from '@/lib/jobs';

/**
 * POST /api/v1/intelligence/daily
 *
 * Fallback for hosts without a long-lived Node process (or to force a run).
 * Auth: `Authorization: Bearer $CRON_SECRET` or `x-cron-secret`.
 *
 * Body optional: `{ tenantId?: string }` — omit to enqueue every tenant whose
 * local time is 03:00 (same gate as the hourly tick).
 */
export async function POST(request: Request) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) || createId();
  const started = Date.now();
  const provided =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  if (!cronSecretMatches(provided)) {
    return Response.json(fail(ErrorCode.AUTHENTICATION_ERROR, 'Unauthorized', requestId), {
      status: 401,
      headers: { [REQUEST_ID_HEADER]: requestId },
    });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { tenantId?: string };
    if (body.tenantId) {
      const result = await runIntelligenceDaily(body.tenantId);
      logger.info({
        request_id: requestId,
        tenant_id: body.tenantId,
        operation: 'intelligence_daily_http',
        duration_ms: Date.now() - started,
      });
      return Response.json(ok({ mode: 'tenant', ...result }, requestId), {
        status: 200,
        headers: { [REQUEST_ID_HEADER]: requestId },
      });
    }

    if (jobsEnabled()) {
      const result = await enqueueDailyForDueTenants();
      return Response.json(ok({ mode: 'enqueue', ...result }, requestId), {
        status: 200,
        headers: { [REQUEST_ID_HEADER]: requestId },
      });
    }

    // No queue: run every active tenant inline (small deployments / cron).
    const { tenantRepository } = await import('@/lib/services');
    const tenants = await tenantRepository.listActive();
    const results = [];
    for (const tenant of tenants) {
      results.push({ tenantId: tenant.id, ...(await runIntelligenceDaily(tenant.id)) });
    }
    return Response.json(ok({ mode: 'inline', tenants: results.length, results }, requestId), {
      status: 200,
      headers: { [REQUEST_ID_HEADER]: requestId },
    });
  } catch (error) {
    logger.error({
      request_id: requestId,
      operation: 'intelligence_daily_http',
      duration_ms: Date.now() - started,
      err: error instanceof Error ? error.message : String(error),
    });
    return Response.json(fail(ErrorCode.INTERNAL_ERROR, 'Daily run failed', requestId), {
      status: 500,
      headers: { [REQUEST_ID_HEADER]: requestId },
    });
  }
}
