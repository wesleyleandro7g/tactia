import { describe, expect, it } from 'vitest';
import { MySqlConnector } from '../mysql-connector';
import { PostgresConnector } from '../postgres-connector';
import {
  buildSqlConnector,
  sqlConnectorFromSource,
  sqlDialectFromSource,
} from '../sql-connector';
import { quoteMysqlIdent, quotePgIdent, resourcesFromInformationSchema } from '../sql-helpers';

describe('SQL connector factory', () => {
  it('resolves dialect from legacy postgres type and database config', () => {
    expect(sqlDialectFromSource('postgres')).toBe('postgres');
    expect(sqlDialectFromSource('mysql')).toBe('mysql');
    expect(sqlDialectFromSource('database', { dialect: 'mysql' })).toBe('mysql');
    expect(sqlDialectFromSource('database', {})).toBe('postgres');
    expect(sqlDialectFromSource('csv')).toBeNull();
  });

  it('builds the connector for the selected dialect', () => {
    const shared = {
      host: 'localhost',
      port: 3306,
      database: 'app',
      username: 'reader',
      password: 'secret',
    };
    expect(buildSqlConnector({ dialect: 'postgres', ...shared, port: 5432 })).toBeInstanceOf(
      PostgresConnector,
    );
    expect(buildSqlConnector({ dialect: 'mysql', ...shared })).toBeInstanceOf(MySqlConnector);
  });

  it('dispatches from source type and configuration', () => {
    const credentials = { username: 'reader', password: 'secret' };
    expect(
      sqlConnectorFromSource({
        type: 'postgres',
        configuration: { host: 'db', database: 'app' },
        credentials,
      }),
    ).toBeInstanceOf(PostgresConnector);
    expect(
      sqlConnectorFromSource({
        type: 'database',
        configuration: { dialect: 'mysql', host: 'db', database: 'app' },
        credentials,
      }),
    ).toBeInstanceOf(MySqlConnector);
    expect(sqlConnectorFromSource({ type: 'csv', configuration: {} })).toBeNull();
  });
});

describe('SQL identifier quoting and discovery grouping', () => {
  it('quotes identifiers for postgres and mysql', () => {
    expect(quotePgIdent('public')).toBe('"public"');
    expect(quotePgIdent('weird"name')).toBe('"weird""name"');
    expect(quoteMysqlIdent('app')).toBe('`app`');
    expect(quoteMysqlIdent('we`ird')).toBe('`we``ird`');
  });

  it('groups information_schema rows into resources', () => {
    const resources = resourcesFromInformationSchema([
      { table_name: 'clientes', column_name: 'id', data_type: 'varchar', is_nullable: 'NO' },
      { table_name: 'clientes', column_name: 'nome', data_type: 'varchar', is_nullable: 'YES' },
      { table_name: 'pedidos', column_name: 'id', data_type: 'int', is_nullable: 'NO' },
    ]);
    expect(resources).toEqual([
      {
        name: 'clientes',
        columns: [
          { name: 'id', type: 'varchar', nullable: false },
          { name: 'nome', type: 'varchar', nullable: true },
        ],
      },
      {
        name: 'pedidos',
        columns: [{ name: 'id', type: 'int', nullable: false }],
      },
    ]);
  });
});
