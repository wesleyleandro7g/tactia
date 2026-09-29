import { describe, expect, it, vi } from 'vitest';
import { createId } from '@tactia/shared';
import type { RawRecordRepository, UpsertRawRecordInput } from '@tactia/database';
import { WebPortalConnector, type HtmlIngestClient } from '../web-portal-connector';
import { parseWebPortalConfig } from '../web-portal-config';

const recipe = parseWebPortalConfig({
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
});

function client(rows: Array<Record<string, unknown>>): HtmlIngestClient {
  return {
    health: vi.fn(async () => undefined),
    extract: vi.fn(async () => ({
      resource: 'products',
      rows,
      warnings: [],
    })),
  };
}

describe('WebPortalConnector', () => {
  it('discovers columns from the recipe and upserts RawRecord on sync', async () => {
    const ingest = client([
      { sku: 'SKU-1', name: 'Camisa', external_id: 'SKU-1' },
      { sku: 'SKU-2', name: 'Calça', external_id: 'SKU-2' },
    ]);
    const upserts: UpsertRawRecordInput[] = [];
    const connector = new WebPortalConnector(
      {
        tenantId: 'tenant-1',
        dataSourceId: 'source-1',
        recipe,
        client: ingest,
      },
      {
        upsertByKey: async (input: UpsertRawRecordInput) => {
          upserts.push(input);
          return { record: { id: createId(), checksum: input.checksum }, created: true };
        },
      } as unknown as RawRecordRepository,
    );

    const discovered = await connector.discover();
    expect(discovered.resources[0]?.name).toBe('products');
    expect(discovered.resources[0]?.columns.map((column) => column.name)).toEqual(['sku', 'name']);

    const test = await connector.testConnection();
    expect(test.success).toBe(true);
    expect(ingest.health).toHaveBeenCalled();

    const result = await connector.sync({
      tenantId: 'tenant-1',
      dataSourceId: 'source-1',
      syncJobId: 'job-1',
      mappings: [
        {
          sourceEntity: 'products',
          targetEntity: 'product',
          configuration: { fields: [{ source: 'name', target: 'name' }] },
        },
      ],
    });

    expect(result.recordsRead).toBe(2);
    expect(result.recordsCreated).toBe(2);
    expect(upserts[0]?.entityType).toBe('product');
    expect(upserts[0]?.externalId).toBe('SKU-1');
    expect(upserts[0]?.payload).toMatchObject({ sku: 'SKU-1', name: 'Camisa' });
  });

  it('counts rows without external_id as failed', async () => {
    const connector = new WebPortalConnector(
      {
        tenantId: 'tenant-1',
        dataSourceId: 'source-1',
        recipe,
        client: client([{ sku: '', name: 'Sem id', external_id: '' }]),
      },
      {
        upsertByKey: async () => {
          throw new Error('should not upsert');
        },
      } as unknown as RawRecordRepository,
    );

    const result = await connector.sync({
      tenantId: 'tenant-1',
      dataSourceId: 'source-1',
      syncJobId: 'job-1',
      mappings: [
        {
          sourceEntity: 'products',
          targetEntity: 'product',
          configuration: { fields: [] },
        },
      ],
    });
    expect(result.recordsFailed).toBe(1);
    expect(result.recordsCreated).toBe(0);
  });

  it('fails the connection test when the sidecar returns no rows', async () => {
    const ingest = client([]);
    const connector = new WebPortalConnector({
      tenantId: 'tenant-1',
      dataSourceId: 'source-1',
      recipe,
      client: ingest,
    });
    const test = await connector.testConnection();
    expect(test.success).toBe(false);
    expect(test.message).toMatch(/Nenhum registro/i);
  });

  it('requests offset plus limit from the sidecar instead of slicing a short page', async () => {
    const ingest = client([{ sku: 'SKU-21', name: 'Item', external_id: 'SKU-21' }]);
    const connector = new WebPortalConnector({
      tenantId: 'tenant-1',
      dataSourceId: 'source-1',
      recipe,
      client: ingest,
    });
    await connector.fetch('products', { limit: 10, offset: 20 });
    expect(ingest.extract).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20, allowEmpty: false }),
    );
  });
});
