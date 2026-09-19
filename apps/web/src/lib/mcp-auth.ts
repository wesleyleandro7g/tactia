import type { MembershipRole } from '@tactia/shared';

const appBaseUrl = (
  process.env.BETTER_AUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');

export const MCP_RESOURCE_URL = `${appBaseUrl}/mcp`;
export const MCP_AUTH_ISSUER = `${appBaseUrl}/api/v1/auth`;

export const MCP_SCOPES = {
  read: 'tools:read',
  propose: 'tools:propose',
} as const;

export const MCP_TENANT_CLAIM = 'https://tactia.com/claims/tenant_id';
export const MCP_ROLE_CLAIM = 'https://tactia.com/claims/role';
export const MCP_DOMAIN_USER_CLAIM = 'https://tactia.com/claims/user_id';
export const MCP_CONSENT_CLAIM = 'https://tactia.com/claims/consent_id';

export type McpAccessClaims = {
  sub?: string;
  scope?: string;
  client_id?: string;
  [MCP_TENANT_CLAIM]?: string;
  [MCP_ROLE_CLAIM]?: MembershipRole;
  [MCP_DOMAIN_USER_CLAIM]?: string;
  [MCP_CONSENT_CLAIM]?: string;
};

export function isChatGptClientMetadataUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' ||
      url.port || url.username || url.password || url.search || url.hash
    ) return false;
    return (
      url.pathname === '/oauth/client.json' ||
      /^\/oauth\/[A-Za-z0-9_-]+\/client\.json$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function parseOAuthScopes(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}
