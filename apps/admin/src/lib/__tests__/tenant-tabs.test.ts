import { describe, expect, it } from 'vitest';
import {
  isTenantTabActive,
  syncIndicatorLabel,
  TENANT_TABS,
  tenantTabCount,
  tenantTabHref,
} from '../tenant-tabs';

describe('tenant tabs', () => {
  it('lists the tabs in order with Cadastro as default', () => {
    expect(TENANT_TABS.map((tab) => tab.label)).toEqual([
      'Cadastro',
      'Preparação',
      'Piloto',
      'Usuários',
      'Integrações',
      'Sincronização',
      'Atividade',
      'Chat',
      'WhatsApp',
      'Email',
      'API keys',
      'Conexões',
      'Documentos',
      'Playbooks',
      'Agendamentos',
      'Automações',
    ]);
    expect(TENANT_TABS[0]?.segment).toBe('');
  });

  it('builds hrefs', () => {
    expect(tenantTabHref('t1', '')).toBe('/tenants/t1');
    expect(tenantTabHref('t1', 'preparation')).toBe('/tenants/t1/preparation');
    expect(tenantTabHref('t1', 'metrics')).toBe('/tenants/t1/metrics');
    expect(tenantTabHref('t1', 'users')).toBe('/tenants/t1/users');
    expect(tenantTabHref('t1', 'chat')).toBe('/tenants/t1/chat');
    expect(tenantTabHref('t1', 'whatsapp')).toBe('/tenants/t1/whatsapp');
    expect(tenantTabHref('t1', 'email')).toBe('/tenants/t1/email');
    expect(tenantTabHref('t1', 'api-keys')).toBe('/tenants/t1/api-keys');
    expect(tenantTabHref('t1', 'documents')).toBe('/tenants/t1/documents');
  });

  it('activates Cadastro only on the exact tenant path', () => {
    expect(isTenantTabActive('/tenants/t1', 't1', '')).toBe(true);
    expect(isTenantTabActive('/tenants/t1/', 't1', '')).toBe(true);
    expect(isTenantTabActive('/tenants/t1/users', 't1', '')).toBe(false);
  });

  it('activates other tabs on exact or nested paths, not on prefixes', () => {
    expect(isTenantTabActive('/tenants/t1/integrations', 't1', 'integrations')).toBe(true);
    expect(isTenantTabActive('/tenants/t1/integrations/x', 't1', 'integrations')).toBe(true);
    expect(isTenantTabActive('/tenants/t1/integrations-foo', 't1', 'integrations')).toBe(false);
    expect(isTenantTabActive('/tenants/t2/users', 't1', 'users')).toBe(false);
    expect(isTenantTabActive('/tenants/t1/preparation', 't1', 'preparation')).toBe(true);
    expect(isTenantTabActive('/tenants/t1/metrics', 't1', 'metrics')).toBe(true);
    expect(isTenantTabActive('/tenants/t1/metrics', 't1', '')).toBe(false);
  });

  it('maps counts to tabs', () => {
    const indicators = { users: 4, dataSources: 0, sync: 'failed' as const };
    expect(tenantTabCount('users', indicators)).toBe(4);
    expect(tenantTabCount('integrations', indicators)).toBe(0);
    expect(tenantTabCount('sync', indicators)).toBeUndefined();
    expect(tenantTabCount('users', undefined)).toBeUndefined();
  });

  it('labels the sync indicator', () => {
    expect(syncIndicatorLabel('failed')).toBe('último sync falhou');
    expect(syncIndicatorLabel('running')).toBe('sync em andamento');
    expect(syncIndicatorLabel(null)).toBeNull();
    expect(syncIndicatorLabel(undefined)).toBeNull();
  });
});
