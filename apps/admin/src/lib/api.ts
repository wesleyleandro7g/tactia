import { ZodError } from 'zod';
import {
  AppError,
  ErrorCode,
  REQUEST_ID_HEADER,
  createId,
  fail,
  isAppError,
  logger,
  ok,
  type RequestContext,
} from '@tactia/shared';
import { operatorAuth } from './auth';
import { enforceRateLimit, type RateLimitPolicy } from './rate-limit';
import { operatorService } from './services';

export function getClientIp(request: Request): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  );
}

export async function resolveOperatorContext(request: Request): Promise<RequestContext> {
  const requestId = request.headers.get(REQUEST_ID_HEADER) || createId();
  const ip = getClientIp(request);

  const session = await operatorAuth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return { requestId, tenantId: null, userId: null, role: null, operatorId: null, ip };
  }

  const operator = await operatorService.ensureFromExternalAuth({
    externalAuthId: session.user.id,
    name: session.user.name,
    email: session.user.email,
  });

  if (operator.status !== 'active') {
    return { requestId, tenantId: null, userId: null, role: null, operatorId: null, ip };
  }

  return {
    requestId,
    tenantId: null,
    userId: null,
    role: null,
    operatorId: operator.id,
    ip,
  };
}

type Handler = (
  request: Request,
  ctx: RequestContext,
  params: Record<string, string>,
) => Promise<unknown> | unknown;

function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof ZodError) {
    return new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid request', error.flatten());
  }
  logger.error({ err: error }, 'unhandled error');
  return new AppError(ErrorCode.INTERNAL_ERROR, 'Internal server error');
}

export function createApiHandler(
  options: { auth: 'none' | 'operator'; rateLimit?: RateLimitPolicy },
  handler: Handler,
) {
  return async (request: Request, segment?: { params: Promise<Record<string, string>> }) => {
    const started = Date.now();
    const params = segment ? await segment.params : {};
    let ctx: RequestContext = {
      requestId: request.headers.get(REQUEST_ID_HEADER) || createId(),
      tenantId: null,
      userId: null,
      role: null,
      operatorId: null,
      ip: getClientIp(request),
    };

    try {
      if (options.auth === 'operator') {
        ctx = await resolveOperatorContext(request);
        if (!ctx.operatorId) {
          throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Authentication required');
        }
      }

      if (options.rateLimit) enforceRateLimit(options.rateLimit, ctx);

      const result = await handler(request, ctx, params);
      if (result instanceof Response) {
        const headers = new Headers(result.headers);
        headers.set(REQUEST_ID_HEADER, ctx.requestId);
        return new Response(result.body, { status: result.status, headers });
      }

      const status = request.method === 'POST' ? 201 : 200;
      logger.info({
        request_id: ctx.requestId,
        operator_id: ctx.operatorId,
        operation: `${request.method} ${new URL(request.url).pathname}`,
        duration_ms: Date.now() - started,
        status,
      });
      return Response.json(ok(result, ctx.requestId), {
        status,
        headers: { [REQUEST_ID_HEADER]: ctx.requestId },
      });
    } catch (error) {
      const appError = toAppError(error);
      const entry = {
        request_id: ctx.requestId,
        operator_id: ctx.operatorId,
        operation: `${request.method} ${new URL(request.url).pathname}`,
        duration_ms: Date.now() - started,
        status: appError.statusCode,
        error: appError.code,
      };
      if (appError.statusCode >= 500) logger.error(entry);
      else if (appError.statusCode === 429) logger.warn(entry);
      else logger.info(entry);
      return Response.json(fail(appError.code, appError.message, ctx.requestId, appError.details), {
        status: appError.statusCode,
        headers: { [REQUEST_ID_HEADER]: ctx.requestId },
      });
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid JSON body');
  }
}

export function searchParamsRecord(request: Request): Record<string, string | undefined> {
  const { searchParams } = new URL(request.url);
  return Object.fromEntries(searchParams.entries());
}
