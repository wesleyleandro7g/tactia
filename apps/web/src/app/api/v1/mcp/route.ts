import { AuditAction } from '@tactia/domain';
import { handleMcpHttpRequest } from '@tactia/ai';
import { createApiHandler } from '@/lib/api';
import { toToolContext, toolRegistry } from '@/lib/ai';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { auditLogService } from '@/lib/services';

async function handle(request: Request, ctx: Parameters<typeof toToolContext>[0]) {
  const toolCtx = { ...toToolContext(ctx), origin: 'mcp' as const };
  return handleMcpHttpRequest(request, {
    registry: toolRegistry,
    ctx: toolCtx,
    scopes: ctx.apiKeyScopes ?? ['tools:read'],
    onToolCall: (event) => {
      void auditLogService.record(ctx, {
        action: AuditAction.MCP_TOOL_CALLED,
        entityType: 'tenant_api_key',
        entityId: ctx.apiKeyId ?? toolCtx.userId ?? toolCtx.tenantId,
        actorType: 'mcp',
        metadata: {
          tool: event.tool,
          keyPrefix: ctx.apiKeyPrefix,
          duration_ms: event.durationMs,
          ...(event.error ? { error: event.error } : {}),
        },
      });
    },
  });
}

/**
 * POST /api/v1/mcp — Streamable HTTP JSON-RPC (SDK 1.30, stateless).
 * Auth is TenantApiKey only. GET/DELETE exist because the same transport
 * uses them for SSE / session teardown; Claude Desktop talks over POST.
 */
export const POST = createApiHandler(
  { auth: 'api_key', rateLimit: RATE_LIMITS.mcp },
  async (request, ctx) => handle(request, ctx),
);

export const GET = createApiHandler(
  { auth: 'api_key', rateLimit: RATE_LIMITS.mcp },
  async (request, ctx) => handle(request, ctx),
);

export const DELETE = createApiHandler(
  { auth: 'api_key', rateLimit: RATE_LIMITS.mcp },
  async (request, ctx) => handle(request, ctx),
);
