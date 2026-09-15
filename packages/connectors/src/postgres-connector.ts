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
import type { RawRecordRepository } from '@tactia/database';
import {
  SQL_BATCH_SIZE,
  normalizeSqlRow,
  quotePgIdent,
  resourcesFromInformationSchema,
  syncSqlMappings,
} from './sql-helpers';

export type PostgresConnectorConfig = {
  host: string;
  port: number;
  database: string;
  schema?: string;
  ssl?: boolean;
  username: string;
  password: string;
};

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

      return { resources: resourcesFromInformationSchema(rows) };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async fetch(resource: string, options?: FetchOptions): Promise<RawRow[]> {
    const client = this.newClient();
    try {
      await client.connect();
      const limit = options?.limit ?? SQL_BATCH_SIZE;
      const offset = options?.offset ?? 0;
      const qualified = `${quotePgIdent(this.schema)}.${quotePgIdent(resource)}`;
      const { rows } = await client.query(`SELECT * FROM ${qualified} LIMIT $1 OFFSET $2`, [limit, offset]);
      return rows as RawRow[];
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  normalize(row: RawRow, fieldMappings: FieldMapping[]): Record<string, unknown> {
    return normalizeSqlRow(row, fieldMappings);
  }

  async sync(context: SyncContext): Promise<SyncResult> {
    if (!this.rawRecords) {
      throw new Error('RawRecordRepository required for sync');
    }
    return syncSqlMappings({
      rawRecords: this.rawRecords,
      context,
      fetch: (resource, options) => this.fetch(resource, options),
    });
  }
}
