import { describe, expect, it } from 'vitest';
import { createId } from '@tactia/shared';
import { McpConnector } from '../mcp-connector';
import type { McpRpc } from '../mcp-connector';
import type { RawRecordRepository, UpsertRawRecordInput } from '@tactia/database';

describe('E17 McpConnector', () => {
  it('E17: McpConnector fetch upserts RawRecord from mock server', async () => {
    const upserts: UpsertRawRecordInput[] = [];
    const rpc: McpRpc = async (method, params) => {
      if (method === 'initialize') return { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } };
      if (method === 'tools/list') {
        return { tools: [{ name: 'list_orders', description: 'orders', inputSchema: { type: 'object' } }] };
      }
      if (method === 'tools/call') {
        expect(params?.['name']).toBe('list_orders');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify([
                { id: 'ord-1', name: 'Pedido 1', total: 120 },
                { id: 'ord-2', name: 'Pedido 2', total: 80 },
              ]),
            },
          ],
        };
      }
      throw new Error(`unexpected ${method}`);
    };

    const connector = new McpConnector(
      { url: 'http://mcp.test/mcp', rpc },
      {
        upsertByKey: async (input: UpsertRawRecordInput) => {
          upserts.push(input);
          return { record: { id: createId(), checksum: input.checksum }, created: true };
        },
      } as unknown as RawRecordRepository,
    );

    const test = await connector.testConnection();
    expect(test.success).toBe(true);

    const discovered = await connector.discover();
    expect(discovered.resources[0]?.name).toBe('list_orders');
    expect(discovered.resources[0]?.columns.map((column) => column.name)).toEqual(['name', 'type']);

    const tenantId = createId();
    const dataSourceId = createId();
    const syncJobId = createId();
    const result = await connector.sync({
      tenantId,
      dataSourceId,
      syncJobId,
      mappings: [{ sourceEntity: 'list_orders', targetEntity: 'sale', configuration: { fields: [] } }],
    });

    expect(result.recordsRead).toBe(2);
    expect(result.recordsCreated).toBe(2);
    expect(upserts).toHaveLength(2);
    expect(upserts[0]?.payload).toMatchObject({ id: 'ord-1', total: 120 });
    expect(upserts[0]?.tenantId).toBe(tenantId);
    expect(upserts[0]?.entityType).toBe('sale');
  });
});
