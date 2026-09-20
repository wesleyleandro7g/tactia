import { requireMcpAuth } from '@better-auth/mcp';
import { AuditAction } from '@tactia/domain';
import { handleMcpHttpRequest, isPublicMcpMethod } from '@tactia/ai';
import { ErrorCode, isAppError, logger } from '@tactia/shared';
import { auth } from '@/lib/auth';
import { toolRegistry, toToolContext } from '@/lib/ai';
import { MCP_AUTH_ISSUER, MCP_RESOURCE_URL, MCP_SCOPES } from '@/lib/mcp-auth';
import { resolveOAuthMcpContext } from '@/lib/mcp-oauth-context';
import { describeMcpAuth } from '@/lib/mcp-oauth-debug';
import { peekMcpRpcMethod, publicMcpCatalogContext } from '@/lib/mcp-public';
import { enforceDistributedMcpRateLimit } from '@/lib/mcp-rate-limit';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { auditLogService } from '@/lib/services';

const protectedHandler = requireMcpAuth(
  auth,
  async (request, claims) => {
    try {
      const ctx = await resolveOAuthMcpContext(request, claims);
      await enforceDistributedMcpRateLimit(RATE_LIMITS.mcp, ctx.mcpAuthorizationId);
      const toolCtx = { ...toToolContext(ctx), origin: 'mcp' as const };
      return await handleMcpHttpRequest(request, {
        registry: toolRegistry,
        ctx: toolCtx,
        scopes: ctx.apiKeyScopes,
        profile: ctx.profile,
        onToolCall: (event) => {
          void auditLogService.record(ctx, {
            action: AuditAction.MCP_TOOL_CALLED,
            entityType: 'oauth_consent',
            entityId: ctx.mcpAuthorizationId,
            actorType: 'mcp',
            metadata: {
              clientId: ctx.mcpClientId,
              tool: event.tool,
              duration_ms: event.durationMs,
              ...(event.error ? { error: event.error } : {}),
            },
          });
        },
      });
    } catch (error) {
      if (!isAppError(error) || (
        error.code !== ErrorCode.AUTHENTICATION_ERROR && error.code !== ErrorCode.AUTHORIZATION_ERROR
      )) {
        const limited = isAppError(error) && error.code === ErrorCode.RATE_LIMITED;
        logger.error({ operation: 'MCP request', error: isAppError(error) ? error.code : 'UNKNOWN' });
        return Response.json({
          jsonrpc: '2.0', id: null,
          error: { code: -32603, message: limited ? error.message : 'Falha ao processar a solicitação.' },
        }, {
          status: limited ? 429 : 500,
          headers: limited ? { 'Retry-After': String(Math.ceil(RATE_LIMITS.mcp.windowMs / 1000)) } : {},
        });
      }
      const message = isAppError(error) ? error.message : 'Não foi possível validar a conexão.';
      logger.info({ operation: 'MCP OAuth context', error: isAppError(error) ? error.code : 'UNKNOWN' });
      const challenge = `Bearer resource_metadata="${MCP_RESOURCE_URL.replace(/\/mcp$/, '/.well-known/oauth-protected-resource/mcp')}", error="invalid_token", error_description="${message.replace(/["\\]/g, '')}"`;
      return Response.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32001, message },
          _meta: { 'mcp/www_authenticate': [challenge] },
        },
        { status: 401, headers: { 'WWW-Authenticate': challenge } },
      );
    }
  },
  {
    resource: MCP_RESOURCE_URL,
    issuer: MCP_AUTH_ISSUER,
    jwksUrl: `${MCP_AUTH_ISSUER}/jwks`,
    challengeScopes: [MCP_SCOPES.read],
  },
);

async function handleRequest(request: Request) {
  const origin = request.headers.get('origin');
  const authorization = request.headers.get('authorization');
  const method = await peekMcpRpcMethod(request);
  if (origin && origin !== new URL(MCP_RESOURCE_URL).origin && origin !== 'https://chatgpt.com') {
    const response = Response.json({ error: 'Origem não permitida' }, { status: 403 });
    logMcpRequest(method, authorization, response);
    return response;
  }

  // ChatGPT lists tools before it attaches the bearer. Keep initialize/tools/list
  // public (with oauth2 securitySchemes) and require a token only for tools/call.
  if (!authorization && isPublicMcpMethod(method)) {
    const catalog = publicMcpCatalogContext();
    const response = await handleMcpHttpRequest(request, {
      registry: toolRegistry,
      ctx: catalog.ctx,
      scopes: catalog.scopes,
      profile: catalog.profile,
    });
    logMcpRequest(method, authorization, response);
    return response;
  }

  const response = await protectedHandler(request);
  logMcpRequest(method, authorization, response);
  return response;
}

function logMcpRequest(method: string | null, authorization: string | null, response: Response): void {
  logger.info({
    method,
    has_authorization: Boolean(authorization),
    ...describeMcpAuth(response.status, authorization, response.headers.get('WWW-Authenticate')),
  }, '[MCP AUTH]');
}

export const POST = handleRequest;
export const GET = handleRequest;
export const DELETE = handleRequest;
