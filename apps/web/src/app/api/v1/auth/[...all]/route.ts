import {
  AppError,
  ErrorCode,
  fail,
  logger,
  REQUEST_ID_HEADER,
  createId,
} from '@tactia/shared';
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';
import { getClientIp } from '@/lib/api';
import { consumeRateLimit } from '@/lib/rate-limit';

const handler = toNextJsHandler(auth);

/** Brute-force guard on the credential endpoints (spec §49): 30 req/min por IP. */
function rateLimited(request: Request): Response | null {
  // Discovery and JWKS must remain available independently of login attempts.
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && (path.endsWith('/jwks') || path.includes('/.well-known/'))) return null;
  const ip = getClientIp(request) ?? 'unknown';
  const allowed = consumeRateLimit(`auth:${ip}`, 30, 60_000);
  if (allowed) return null;

  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? createId();
  const error = new AppError(
    ErrorCode.RATE_LIMITED,
    'Muitas tentativas. Aguarde um instante e tente novamente.',
  );
  logger.warn({
    request_id: requestId,
    tenant_id: null,
    user_id: null,
    operation: `${request.method} ${new URL(request.url).pathname}`,
    duration_ms: 0,
    status: error.statusCode,
    error: error.code,
    ip,
  });
  return Response.json(fail(error.code, error.message, requestId), {
    status: error.statusCode,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

export async function GET(request: Request) {
  const blocked = rateLimited(request);
  if (blocked) return blocked;
  return handler.GET(request);
}

export async function POST(request: Request) {
  const blocked = rateLimited(request);
  if (blocked) return blocked;
  return handler.POST(request);
}
