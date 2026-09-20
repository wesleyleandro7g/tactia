import { createId, type RequestContext } from '@tactia/shared';
import { MCP_SCOPES } from './mcp-auth';
import { toToolContext } from './ai';

/** Catalog-only context: tools/list schemas, never used for tools/call. */
export function publicMcpCatalogContext() {
  const ctx: RequestContext = {
    requestId: createId(),
    tenantId: 'mcp-catalog',
    userId: 'mcp-catalog',
    role: 'owner',
    ip: null,
  };
  return {
    ctx: { ...toToolContext(ctx), origin: 'mcp' as const },
    scopes: [MCP_SCOPES.read, MCP_SCOPES.propose],
    profile: {
      id: 'prf_catalog',
      name: 'Tactia',
      email: 'mcp@tactia.local',
      nickname: 'Tactia',
    },
  };
}

export async function peekMcpRpcMethod(request: Request): Promise<string | null> {
  try {
    const payload = await request.clone().json() as { method?: unknown };
    return typeof payload.method === 'string' ? payload.method : null;
  } catch {
    return null;
  }
}
