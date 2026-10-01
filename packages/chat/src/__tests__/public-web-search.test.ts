import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicWebSearchTool } from '../server/public-web-search';
import { isPublicPageRequest, publicWebInitialToolChoice } from '../server/public-web-routing';
import { browserInitialToolChoice } from '../server/browser/tool-routing';

afterEach(() => vi.unstubAllGlobals());

describe('public web research', () => {
  it('routes market questions to public search and registered systems to browser profiles', () => {
    const names = ['search_public_web', 'list_browser_profiles'];
    expect(publicWebInitialToolChoice('Quais tendências do setor varejista?', names)?.toolName).toBe('search_public_web');
    expect(browserInitialToolChoice('Busque no sistema o pedido mais recente', names)?.toolName).toBe('list_browser_profiles');
    expect(publicWebInitialToolChoice('Quanto vendemos este mês?', names)).toBeUndefined();
    expect(publicWebInitialToolChoice('Leia https://example.org/relatorio', names)?.toolName).toBe('search_public_web');
    expect(isPublicPageRequest('Leia https://example.org/relatorio')).toBe(true);
    expect(isPublicPageRequest('Abra https://erp.example.org no sistema')).toBe(false);
  });

  it('returns public citations and removes confidential values from the query', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{
        title: 'Relatório setorial', url: 'https://example.org/relatorio',
        content: 'Crescimento de 12% no setor.', published_date: '2026-09-01',
      }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{
        url: 'https://example.org/relatorio', raw_content: 'Crescimento de 12% no setor segundo o relatório.',
      }] }) });
    vi.stubGlobal('fetch', fetch);
    const tool = createPublicWebSearchTool('test-key');
    const result = await tool.execute({ requestId: 'test', tenantId: 'tenant', userId: 'user', role: 'member' }, {
      query: 'Mercado de varejo contato dono@empresa.com receita R$ 123.456',
    });
    expect(JSON.stringify(fetch.mock.calls[0]?.[1]?.body)).not.toContain('dono@empresa.com');
    expect(JSON.stringify(fetch.mock.calls[0]?.[1]?.body)).not.toContain('123.456');
    expect(result.sources[0]).toMatchObject({
      url: 'https://example.org/relatorio', publishedAt: '2026-09-01', tool: 'search_public_web',
    });
  });
});
