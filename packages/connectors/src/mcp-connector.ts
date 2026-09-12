import { AppError, ErrorCode } from '@tactia/shared';
import { DEFAULT_NEGOTIATED_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { RawRecordRepository } from '@tactia/database';
import { applyTransform } from './transforms';
import { computeChecksum } from './checksum';
import type {
  Connector,
  ConnectionTestResult,
  DiscoveryResult,
  FetchOptions,
  FieldMapping,
  RawRow,
  SyncContext,
  SyncResult,
} from './types';

export const MCP_HTTP_ACCEPT = 'application/json, text/event-stream';

export type McpRpc = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export type McpConnectorConfig = {
  url: string;
  authorization?: string;
  /** Injected in tests — in-process JSON-RPC, no network. */
  rpc?: McpRpc;
  fetch?: typeof fetch;
};

export class McpConnector implements Connector {
  constructor(
    private readonly config: McpConnectorConfig,
    private readonly rawRecords?: RawRecordRepository,
  ) {}

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.request('initialize', {
        protocolVersion: DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'tactia', version: '0.1.0' },
      });
      await this.request('tools/list', {});
      return { success: true, message: 'MCP server reachable' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  async discover(): Promise<DiscoveryResult> {
    const listed = asRecord(await this.request('tools/list', {}));
    const tools = Array.isArray(listed['tools']) ? listed['tools'] : [];
    return {
      resources: tools.map((tool) => {
        const name = typeof asRecord(tool)['name'] === 'string' ? String(asRecord(tool)['name']) : 'tool';
        return {
          name,
          columns: [
            { name: 'name', type: 'string', nullable: false },
            { name: 'type', type: 'string', nullable: true },
          ],
        };
      }),
    };
  }

  async fetch(resource: string, options?: FetchOptions): Promise<RawRow[]> {
    const result = await this.request('tools/call', { name: resource, arguments: {} });
    const rows = rowsFromToolResult(result);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  normalize(row: RawRow, fieldMappings: FieldMapping[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const mapping of fieldMappings) {
      result[mapping.target] = applyTransform(row[mapping.source], mapping.transform);
    }
    return result;
  }

  async sync(context: SyncContext): Promise<SyncResult> {
    if (!this.rawRecords) {
      throw new Error('RawRecordRepository required for sync');
    }

    const counters = { read: 0, created: 0, updated: 0, failed: 0 };

    for (const mapping of context.mappings) {
      const rows = await this.fetch(mapping.sourceEntity);
      for (const row of rows) {
        counters.read += 1;
        try {
          const externalId = String(row['external_id'] ?? row['id'] ?? counters.read);
          const checksum = computeChecksum(row);
          const { created } = await this.rawRecords.upsertByKey({
            tenantId: context.tenantId,
            dataSourceId: context.dataSourceId,
            syncJobId: context.syncJobId,
            externalId,
            entityType: mapping.targetEntity,
            payload: row,
            checksum,
          });
          if (created) counters.created += 1;
          else counters.updated += 1;
        } catch {
          counters.failed += 1;
        }
      }
    }

    context.onProgress?.(counters);
    return {
      recordsRead: counters.read,
      recordsCreated: counters.created,
      recordsUpdated: counters.updated,
      recordsFailed: counters.failed,
    };
  }

  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.config.rpc) return this.config.rpc(method, params);
    return jsonRpcPost(this.config, method, params);
  }
}

async function jsonRpcPost(
  config: McpConnectorConfig,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  if (!config.url) {
    throw new AppError(ErrorCode.CONNECTOR_ERROR, 'MCP url is required');
  }
  const fetchImpl = config.fetch ?? fetch;
  const response = await fetchImpl(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: MCP_HTTP_ACCEPT,
      ...(config.authorization ? { Authorization: config.authorization } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? {} }),
  });
  if (!response.ok) {
    throw new AppError(ErrorCode.CONNECTOR_ERROR, `MCP HTTP ${response.status}`);
  }
  const body = asRecord(await response.json());
  if (body['error'] && typeof body['error'] === 'object') {
    const error = asRecord(body['error']);
    throw new AppError(ErrorCode.CONNECTOR_ERROR, String(error['message'] ?? 'MCP error'));
  }
  return body['result'];
}

export function rowsFromToolResult(result: unknown): RawRow[] {
  if (Array.isArray(result)) return result.filter(isRow);
  if (!result || typeof result !== 'object') return [];
  const record = asRecord(result);

  if (Array.isArray(record['content'])) {
    const rows: RawRow[] = [];
    for (const block of record['content']) {
      const item = asRecord(block);
      if (item['type'] !== 'text' || typeof item['text'] !== 'string') continue;
      rows.push(...rowsFromJsonText(item['text']));
    }
    if (rows.length > 0) return rows;
  }

  if (record['structuredContent'] && typeof record['structuredContent'] === 'object') {
    const structured = asRecord(record['structuredContent']);
    if (Array.isArray(structured['data'])) return structured['data'].filter(isRow);
    if (isRow(structured['data'])) return [structured['data']];
    if (isRow(structured)) return [structured];
  }

  if (Array.isArray(record['data'])) return record['data'].filter(isRow);
  if (Array.isArray(record['items'])) return record['items'].filter(isRow);
  if (isRow(result)) return [result];
  return [];
}

function rowsFromJsonText(text: string): RawRow[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(isRow);
    if (parsed && typeof parsed === 'object') {
      const record = asRecord(parsed);
      if (Array.isArray(record['data'])) return record['data'].filter(isRow);
      if (Array.isArray(record['items'])) return record['items'].filter(isRow);
      if (isRow(parsed)) return [parsed];
    }
  } catch {
    return [{ value: text }];
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isRow(value: unknown): value is RawRow {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
