import { Client } from 'pg';
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
import { applyTransform } from './transforms';
import { computeChecksum } from './checksum';
import type { RawRecordRepository } from '@tactia/database';

export type PostgresConnectorConfig = {
  host: string;
  port: number;
  database: string;
  schema?: string;
  ssl?: boolean;
  username: string;
  password: string;
};

const BATCH_SIZE = 1000;

export class PostgresConnector implements Connector {
  private readonly schema: string;

  constructor(
    private readonly config: PostgresConnectorConfig,
    private readonly rawRecords?: RawRecordRepository,
  ) {
    this.schema = config.schema ?? 'public';
  }

  private newClient(): Client {
    return new Client({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10_000,
    });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const client = this.newClient();
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { success: true, message: 'Connection successful' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async discover(): Promise<DiscoveryResult> {
    const client = this.newClient();
    try {
      await client.connect();
      const { rows } = await client.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1
         ORDER BY table_name, ordinal_position`,
        [this.schema],
      );

      const resourceMap = new Map<string, { name: string; type: string; nullable: boolean }[]>();
      for (const row of rows) {
        const cols = resourceMap.get(row.table_name) ?? [];
        cols.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === 'YES',
        });
        resourceMap.set(row.table_name, cols);
      }

      return {
        resources: Array.from(resourceMap.entries()).map(([name, columns]) => ({
          name,
          columns,
        })),
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async fetch(resource: string, options?: FetchOptions): Promise<RawRow[]> {
    const client = this.newClient();
    try {
      await client.connect();
      const limit = options?.limit ?? BATCH_SIZE;
      const offset = options?.offset ?? 0;
      const { rows } = await client.query(
        `SELECT * FROM "${this.schema}"."${resource}" LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      return rows as RawRow[];
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  normalize(row: RawRow, fieldMappings: FieldMapping[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const fm of fieldMappings) {
      result[fm.target] = applyTransform(row[fm.source], fm.transform);
    }
    return result;
  }

  async sync(context: SyncContext): Promise<SyncResult> {
    if (!this.rawRecords) {
      throw new Error('RawRecordRepository required for sync');
    }

    const counters = { read: 0, created: 0, updated: 0, failed: 0 };

    for (const mapping of context.mappings) {
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const rows = await this.fetch(mapping.sourceEntity, { limit: BATCH_SIZE, offset });
        hasMore = rows.length === BATCH_SIZE;
        offset += rows.length;

        for (const row of rows) {
          counters.read++;
          try {
            const externalId = String(row['id'] ?? row['external_id'] ?? counters.read);
            const checksum = computeChecksum(row as Record<string, unknown>);

            const { created } = await this.rawRecords.upsertByKey({
              tenantId: context.tenantId,
              dataSourceId: context.dataSourceId,
              syncJobId: context.syncJobId,
              externalId,
              entityType: mapping.targetEntity,
              payload: row as Record<string, unknown>,
              checksum,
            });

            if (created) counters.created++;
            else counters.updated++;
          } catch {
            counters.failed++;
          }
        }

        context.onProgress?.(counters);
      }
    }

    return {
      recordsRead: counters.read,
      recordsCreated: counters.created,
      recordsUpdated: counters.updated,
      recordsFailed: counters.failed,
    };
  }
}
