import { AppError, ErrorCode, fail, REQUEST_ID_HEADER, createId } from '@tactia/shared';
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';
import { getClientIp } from '@/lib/api';
import { consumeRateLimit } from '@/lib/rate-limit';

const handler = toNextJsHandler(auth);

function rateLimited(request: Request): Response | null {
  const ip = getClientIp(request) ?? 'unknown';
  const allowed = consumeRateLimit(`auth:${ip}`, 30, 60_000);
  if (allowed) return null;
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? createId();
  const error = new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Too many requests', undefined, 429);
  return Response.json(fail(error.code, error.message, requestId), {
    status: 429,
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
