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

export type RequestContext = {
  requestId: string;
  tenantId: string | null;
  userId: string | null;
  role: MembershipRole | null;
  ip?: string | null;
};

export const TENANT_COOKIE = 'tactia-tenant-id';
export const REQUEST_ID_HEADER = 'x-request-id';
