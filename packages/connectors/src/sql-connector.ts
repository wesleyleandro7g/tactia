import type { RawRecordRepository } from '@tactia/database';
import { MySqlConnector } from './mysql-connector';
import { PostgresConnector } from './postgres-connector';
import type { Connector } from './types';

export type SqlDialect = 'postgres' | 'mysql';

export type SqlConnectionInput = {
  dialect: SqlDialect;
  host: string;
  port: number;
  database: string;
  schema?: string;
  ssl?: boolean;
  username: string;
  password: string;
};

export function isSqlDialect(value: unknown): value is SqlDialect {
  return value === 'postgres' || value === 'mysql';
}

export function defaultSqlPort(dialect: SqlDialect): number {
  return dialect === 'mysql' ? 3306 : 5432;
}

export function sqlDialectFromSource(type: string, configuration?: unknown): SqlDialect | null {
  if (type === 'postgres') return 'postgres';
  if (type === 'mysql') return 'mysql';
  if (type !== 'database') return null;
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    return 'postgres';
  }
  const dialect = (configuration as Record<string, unknown>)['dialect'];
  return isSqlDialect(dialect) ? dialect : 'postgres';
}

export function sqlConnectionInputFrom(
  dialect: SqlDialect,
  configuration: Record<string, unknown>,
  credentials: Record<string, unknown>,
): SqlConnectionInput {
  return {
    dialect,
    host: String(configuration['host'] ?? 'localhost'),
    port: Number(configuration['port'] ?? defaultSqlPort(dialect)),
    database: String(configuration['database'] ?? ''),
    schema: configuration['schema'] ? String(configuration['schema']) : undefined,
    ssl: configuration['ssl'] === true,
    username: String(credentials['username'] ?? ''),
    password: String(credentials['password'] ?? ''),
  };
}

export function buildSqlConnector(
  input: SqlConnectionInput,
  rawRecords?: RawRecordRepository,
): Connector {
  if (input.dialect === 'mysql') {
    return new MySqlConnector(input, rawRecords);
  }
  return new PostgresConnector(input, rawRecords);
}

export function sqlConnectorFromSource(args: {
  type: string;
  configuration: unknown;
  credentials?: Record<string, unknown>;
  rawRecords?: RawRecordRepository;
}): Connector | null {
  const dialect = sqlDialectFromSource(args.type, args.configuration);
  if (!dialect) return null;
  const configuration =
    args.configuration && typeof args.configuration === 'object' && !Array.isArray(args.configuration)
      ? (args.configuration as Record<string, unknown>)
      : {};
  return buildSqlConnector(
    sqlConnectionInputFrom(dialect, configuration, args.credentials ?? {}),
    args.rawRecords,
  );
}
