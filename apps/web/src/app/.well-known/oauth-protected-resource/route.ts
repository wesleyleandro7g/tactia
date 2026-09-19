import { MCP_AUTH_ISSUER, MCP_RESOURCE_URL, MCP_SCOPES } from '@/lib/mcp-auth';

export function GET() {
  return Response.json({
    resource: MCP_RESOURCE_URL,
    authorization_servers: [MCP_AUTH_ISSUER],
    bearer_methods_supported: ['header'],
    scopes_supported: [MCP_SCOPES.read, MCP_SCOPES.propose],
  });
}

export const HEAD = GET;
