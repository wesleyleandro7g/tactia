import { prisma } from '@tactia/database';
import { createId, fail, ok, ErrorCode, REQUEST_ID_HEADER, logger } from '@tactia/shared';

/**
 * GET /api/v1/health — liveness/readiness do container (docker healthcheck,
 * load balancer, runbook). Deliberadamente **sem autenticação**: responde
 * apenas se o processo está de pé e se o banco aceita uma query. Nenhum dado de
 * tenant, versão de dependência ou detalhe de infraestrutura é exposto.
 */
export async function GET(request: Request) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) || createId();
  const started = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(ok({ status: 'ok', database: 'up' }, requestId), {
      status: 200,
      headers: { [REQUEST_ID_HEADER]: requestId, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    logger.error({
      request_id: requestId,
      operation: 'health',
      duration_ms: Date.now() - started,
      status: 503,
      error: ErrorCode.INTERNAL_ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      fail(ErrorCode.INTERNAL_ERROR, 'Service unavailable', requestId),
      {
        status: 503,
        headers: { [REQUEST_ID_HEADER]: requestId, 'Cache-Control': 'no-store' },
      },
    );
  }
}
