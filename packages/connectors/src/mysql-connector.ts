import mysql from 'mysql2/promise';
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
  quoteMysqlIdent,
  resourcesFromInformationSchema,
  syncSqlMappings,
  type InformationSchemaColumnRow,
} from './sql-helpers';

export type MySqlConnectorConfig = {
  host: string;
  port: number;
  database: string;
  schema?: string;
  ssl?: boolean;
  username: string;
  password: string;
};

export class MySqlConnector implements Connector {
  constructor(
    private readonly config: MySqlConnectorConfig,
    private readonly rawRecords?: RawRecordRepository,
  ) {}

  private async newConnection() {
    return mysql.createConnection({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 10_000,
    });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    let connection: mysql.Connection | undefined;
    try {
      connection = await this.newConnection();
      await connection.query('SELECT 1');
      return { success: true, message: 'Connection successful' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    } finally {
      await connection?.end().catch(() => undefined);
    }
  }

  async discover(): Promise<DiscoveryResult> {
    const connection = await this.newConnection();
    try {
      const schema = this.config.schema?.trim() || this.config.database;
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable
         FROM information_schema.columns
         WHERE table_schema = ?
         ORDER BY table_name, ordinal_position`,
        [schema],
      );
      return {
        resources: resourcesFromInformationSchema(rows as InformationSchemaColumnRow[]),
      };
    } finally {
      await connection.end().catch(() => undefined);
    }
  }

  async fetch(resource: string, options?: FetchOptions): Promise<RawRow[]> {
    const connection = await this.newConnection();
    try {
      const limit = options?.limit ?? SQL_BATCH_SIZE;
      const offset = options?.offset ?? 0;
      const schema = this.config.schema?.trim() || this.config.database;
      const qualified = `${quoteMysqlIdent(schema)}.${quoteMysqlIdent(resource)}`;
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT * FROM ${qualified} LIMIT ? OFFSET ?`,
        [limit, offset],
      );
      return rows as RawRow[];
    } finally {
      await connection.end().catch(() => undefined);
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
