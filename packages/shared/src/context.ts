export const MembershipRole = {
  owner: 'owner',
  admin: 'admin',
  member: 'member',
  viewer: 'viewer',
} as const;

export type MembershipRole = (typeof MembershipRole)[keyof typeof MembershipRole];

export const MembershipStatus = {
  active: 'active',
  invited: 'invited',
  suspended: 'suspended',
  removed: 'removed',
} as const;

export type MembershipStatus = (typeof MembershipStatus)[keyof typeof MembershipStatus];

export const TenantStatus = {
  active: 'active',
  suspended: 'suspended',
  deleted: 'deleted',
} as const;

export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export const OperatorStatus = {
  active: 'active',
  disabled: 'disabled',
} as const;

export type OperatorStatus = (typeof OperatorStatus)[keyof typeof OperatorStatus];

export type RequestContext = {
  requestId: string;
  tenantId: string | null;
  userId: string | null;
  role: MembershipRole | null;
  ip?: string | null;
  /** Present when the caller is a backoffice operator (apps/admin). */
  operatorId?: string | null;
  /** Present when the caller authenticated with a TenantApiKey (MCP). */
  apiKeyId?: string | null;
  apiKeyPrefix?: string | null;
  apiKeyScopes?: string[];
};

export const TENANT_COOKIE = 'tactia-tenant-id';
export const REQUEST_ID_HEADER = 'x-request-id';
