import { describe, expect, it } from 'vitest';
import { parseWebPortalConfig } from '../web-portal-config';

const resource = {
  key: 'products',
  startUrl: 'https://portal.cliente.com.br/produtos',
  itemSelector: 'tr.produto',
  idField: 'sku',
  fields: { sku: 'td.sku::text', name: 'td.nome::text' },
};

describe('parseWebPortalConfig', () => {
  it('accepts hosts as a comma-separated string and nested login', () => {
    const parsed = parseWebPortalConfig({
      allowedHosts: 'portal.cliente.com.br, extra.cliente.com.br',
      adaptive: true,
      loginUrl: 'https://portal.cliente.com.br/login',
      loginUsernameField: 'user',
      loginPasswordField: 'pass',
      resources: [resource],
    });
    expect(parsed.allowedHosts).toEqual(['portal.cliente.com.br', 'extra.cliente.com.br']);
    expect(parsed.login).toEqual({
      url: 'https://portal.cliente.com.br/login',
      usernameField: 'user',
      passwordField: 'pass',
    });
    expect(parsed.resources[0]?.key).toBe('products');
    expect(parsed.adaptive).toBe(true);
    expect(parsed.allowEmpty).toBe(false);
    expect(parsed.resources[0]?.allowEmpty).toBe(false);
  });

  it('rejects a start URL outside the allowlist', () => {
    expect(() =>
      parseWebPortalConfig({
        allowedHosts: ['portal.cliente.com.br'],
        resources: [{ ...resource, startUrl: 'https://evil.example/produtos' }],
      }),
    ).toThrow(/hosts autorizados/);
  });

  it('rejects a resource without idField in fields', () => {
    expect(() =>
      parseWebPortalConfig({
        allowedHosts: ['portal.cliente.com.br'],
        resources: [{ ...resource, idField: 'missing' }],
      }),
    ).toThrow(/idField/);
  });
});
