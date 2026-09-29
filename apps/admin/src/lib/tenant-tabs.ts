import type { TenantSyncIndicator } from '@tactia/domain';

export type TenantTabKey =
  | 'profile'
  | 'users'
  | 'integrations'
  | 'sync'
  | 'activity'
  | 'chat'
  | 'whatsapp'
  | 'email'
  | 'api-keys'
  | 'connections'
  | 'documents'
  | 'playbooks'
  | 'schedules'
  | 'preparation';

export type TenantTabSegment =
  | ''
  | 'users'
  | 'integrations'
  | 'sync'
  | 'activity'
  | 'chat'
  | 'whatsapp'
  | 'email'
  | 'api-keys'
  | 'connections'
  | 'documents'
  | 'playbooks'
  | 'schedules'
  | 'preparation';

export type TenantTab = {
  key: TenantTabKey;
  label: string;
  /** Path segment after `/tenants/{id}`; empty string is the default tab. */
  segment: TenantTabSegment;
};

export const TENANT_TABS: readonly TenantTab[] = [
  { key: 'profile', label: 'Cadastro', segment: '' },
  { key: 'preparation', label: 'Preparação', segment: 'preparation' },
  { key: 'users', label: 'Usuários', segment: 'users' },
  { key: 'integrations', label: 'Integrações', segment: 'integrations' },
  { key: 'sync', label: 'Sincronização', segment: 'sync' },
  { key: 'activity', label: 'Atividade', segment: 'activity' },
  { key: 'chat', label: 'Chat', segment: 'chat' },
  { key: 'whatsapp', label: 'WhatsApp', segment: 'whatsapp' },
  { key: 'email', label: 'Email', segment: 'email' },
  { key: 'api-keys', label: 'API keys', segment: 'api-keys' },
  { key: 'connections', label: 'Conexões', segment: 'connections' },
  { key: 'documents', label: 'Documentos', segment: 'documents' },
  { key: 'playbooks', label: 'Playbooks', segment: 'playbooks' },
  { key: 'schedules', label: 'Agendamentos', segment: 'schedules' },
];

export type TenantTabIndicators = {
  users?: number;
  dataSources?: number;
  sync?: TenantSyncIndicator;
};

export function tenantTabHref(tenantId: string, segment: TenantTab['segment']): string {
  const base = `/tenants/${encodeURIComponent(tenantId)}`;
  return segment ? `${base}/${segment}` : base;
}

/**
 * The default tab (Cadastro) only matches the exact tenant path; the other tabs
 * match their path or any nested path below it.
 */
export function isTenantTabActive(pathname: string, tenantId: string, segment: TenantTab['segment']): boolean {
  const href = tenantTabHref(tenantId, segment);
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (!segment) return path === href;
  return path === href || path.startsWith(`${href}/`);
}

export function tenantTabCount(key: TenantTabKey, indicators?: TenantTabIndicators): number | undefined {
  if (key === 'users') return indicators?.users;
  if (key === 'integrations') return indicators?.dataSources;
  return undefined;
}

/** Accessible label for the sync alert dot; `null` means no dot is shown. */
export function syncIndicatorLabel(sync: TenantSyncIndicator | undefined): string | null {
  if (sync === 'failed') return 'último sync falhou';
  if (sync === 'running') return 'sync em andamento';
  return null;
}
