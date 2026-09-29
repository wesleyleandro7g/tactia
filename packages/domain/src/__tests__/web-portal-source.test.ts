import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, type RequestContext } from '@tactia/shared';
import { AuditAction } from '../services/audit-log-service';
import { DataSourceService } from '../services/data-source-service';

const ctx: RequestContext = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  userId: null,
  role: null,
  operatorId: 'operator-1',
};

function service() {
  const dataSources = {
    create: vi.fn(async (input: Record<string, unknown>) => ({
      id: 'ds-1',
      tenantId: 'tenant-1',
      status: 'active',
      lastSyncAt: null,
      ...input,
    })),
  };
  const mappings = { create: vi.fn() };
  const credentials = { findById: vi.fn() };
  const auditLogs = { record: vi.fn(async () => undefined) };
  return {
    dataSources,
    mappings,
    credentials,
    auditLogs,
    service: new DataSourceService(
      dataSources as never,
      mappings as never,
      credentials as never,
      auditLogs as never,
    ),
  };
}

const validConfiguration = {
  allowedHosts: ['portal.cliente.com.br'],
  resources: [
    {
      key: 'products',
      startUrl: 'https://portal.cliente.com.br/produtos',
      itemSelector: 'tr.produto',
      idField: 'sku',
      fields: { sku: 'td.sku::text', name: 'td.nome::text' },
    },
  ],
};

describe('web_portal data source', () => {
  it('rejects an invalid recipe with VALIDATION_ERROR', async () => {
    const { service: dataSourceService, dataSources } = service();
    await expect(
      dataSourceService.create(ctx, {
        name: 'Portal',
        type: 'web_portal',
        configuration: { allowedHosts: 'portal.cliente.com.br' },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    expect(dataSources.create).not.toHaveBeenCalled();
  });

  it('creates a web_portal source when the recipe is valid', async () => {
    const { service: dataSourceService, dataSources, auditLogs } = service();
    const created = await dataSourceService.create(ctx, {
      name: 'Portal do cliente',
      type: 'web_portal',
      configuration: validConfiguration,
    });
    expect(created.id).toBe('ds-1');
    expect(dataSources.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'web_portal', name: 'Portal do cliente' }),
    );
    expect(auditLogs.record).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ action: AuditAction.DATA_SOURCE_CREATED, entityId: 'ds-1' }),
    );
  });
});
