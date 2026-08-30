import { ZodError } from 'zod';
import {
  AppError,
  ErrorCode,
  REQUEST_ID_HEADER,
  TENANT_COOKIE,
  createId,
  fail,
  isAppError,
  logger,
  ok,
  type MembershipRole,
  type RequestContext,
} from '@tactia/shared';
import { cookies } from 'next/headers';
import { auth } from './auth';
import { tenantService, userService } from './services';

export function getClientIp(request: Request): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  );
}

export async function resolveRequestContext(request: Request): Promise<RequestContext> {
  const requestId = request.headers.get(REQUEST_ID_HEADER) || createId();
  const ip = getClientIp(request);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return { requestId, tenantId: null, userId: null, role: null, ip };
  }

  const domainUser = await userService.ensureFromExternalAuth({
    externalAuthId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    avatarUrl: session.user.image,
  });

  const cookieStore = await cookies();
  const preferredTenantId = cookieStore.get(TENANT_COOKIE)?.value ?? null;
  const membership = await tenantService.resolveActiveMembership(domainUser.id, preferredTenantId);

  return {
    requestId,
    tenantId: membership?.tenantId ?? null,
    userId: domainUser.id,
    role: (membership?.role as MembershipRole | undefined) ?? null,
    ip,
  };
}

type AuthMode = 'none' | 'user' | 'tenant';

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
  options: { auth: AuthMode; roles?: MembershipRole[] },
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
    };

    try {
      ctx = await resolveRequestContext(request);

      if (options.auth === 'user' || options.auth === 'tenant') {
        if (!ctx.userId) {
          throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Authentication required');
        }
      }
      if (options.auth === 'tenant') {
        if (!ctx.tenantId || !ctx.role) {
          throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
        }
        if (options.roles && !options.roles.includes(ctx.role)) {
          throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Insufficient permissions');
        }
      }

      const result = await handler(request, ctx, params);
      if (result instanceof Response) return withRequestId(result, ctx.requestId);

      const status =
        request.method === 'POST' && !new URL(request.url).pathname.endsWith('/switch') ? 201 : 200;
      const body = ok(result, ctx.requestId);
      logger.info({
        request_id: ctx.requestId,
        tenant_id: ctx.tenantId,
        user_id: ctx.userId,
        operation: `${request.method} ${new URL(request.url).pathname}`,
        duration_ms: Date.now() - started,
        status,
      });
      return Response.json(body, {
        status,
        headers: { [REQUEST_ID_HEADER]: ctx.requestId },
      });
    } catch (error) {
      const appError = toAppError(error);
      logger.info({
        request_id: ctx.requestId,
        tenant_id: ctx.tenantId,
        user_id: ctx.userId,
        operation: `${request.method} ${new URL(request.url).pathname}`,
        duration_ms: Date.now() - started,
        status: appError.statusCode,
        error: appError.code,
      });
      return Response.json(fail(appError.code, appError.message, ctx.requestId, appError.details), {
        status: appError.statusCode,
        headers: { [REQUEST_ID_HEADER]: ctx.requestId },
      });
    }
  };
}

function withRequestId(response: Response, requestId: string) {
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return new Response(response.body, { status: response.status, headers });
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
