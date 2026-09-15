import { describe, expect, it } from 'vitest';
import {
  incrementalDateColumn,
  incrementalFetchDecision,
  incrementalLookbackSince,
} from '../incremental';
import { buildSqlFetchQuery, quoteMysqlIdent, quotePgIdent, syncSqlMappings } from '../sql-helpers';

describe('incremental fetch decision', () => {
  const saleFields = [
    { source: 'pedido_em', target: 'sold_at' },
    { source: 'id', target: 'external_id' },
  ];

  it('does not filter in full mode', () => {
    expect(incrementalFetchDecision('full', 'sale', saleFields)).toEqual({ fetch: true });
  });

  it('uses the mapped source column for facts in incremental mode', () => {
    expect(incrementalFetchDecision('incremental', 'sale', saleFields)).toEqual({
      fetch: true,
      dateColumn: 'pedido_em',
    });
    expect(incrementalDateColumn('payment', [{ source: 'vence', target: 'due_at' }])).toBe('vence');
    expect(
      incrementalDateColumn('payment', [
        { source: 'pago', target: 'paid_at' },
        { source: 'vence', target: 'due_at' },
      ]),
    ).toBe('pago');
  });

  it('skips a fact mapping without a date column', () => {
    expect(
      incrementalFetchDecision('incremental', 'sale', [{ source: 'id', target: 'external_id' }]),
    ).toEqual({ fetch: false, reason: 'incremental_missing_date_column' });
  });

  it('does not filter cadastros', () => {
    expect(
      incrementalFetchDecision('incremental', 'customer', [{ source: 'id', target: 'external_id' }]),
    ).toEqual({ fetch: true });
    expect(incrementalFetchDecision('incremental', 'lead', [])).toEqual({ fetch: true });
  });
});

describe('incrementalLookbackSince', () => {
  it('subtracts three calendar months from the civil date in the timezone', () => {
    const now = new Date('2026-09-15T18:00:00.000Z');
    expect(incrementalLookbackSince(now, 'America/Sao_Paulo').toISOString()).toBe(
      '2026-06-15T00:00:00.000Z',
    );
  });
});

describe('buildSqlFetchQuery', () => {
  it('paginates without a date filter', () => {
    expect(
      buildSqlFetchQuery({
        dialect: 'postgres',
        schema: 'public',
        table: 'clientes',
        limit: 1000,
        offset: 0,
      }),
    ).toEqual({
      sql: `SELECT * FROM ${quotePgIdent('public')}.${quotePgIdent('clientes')} LIMIT $1 OFFSET $2`,
      values: [1000, 0],
    });
    expect(
      buildSqlFetchQuery({
        dialect: 'mysql',
        schema: 'app',
        table: 'clientes',
        limit: 50,
        offset: 10,
      }),
    ).toEqual({
      sql: `SELECT * FROM ${quoteMysqlIdent('app')}.${quoteMysqlIdent('clientes')} LIMIT ? OFFSET ?`,
      values: [50, 10],
    });
  });

  it('adds a quoted WHERE for facts', () => {
    const since = new Date('2026-06-15T00:00:00.000Z');
    const pg = buildSqlFetchQuery({
      dialect: 'postgres',
      schema: 'erp',
      table: 'pedidos',
      limit: 1000,
      offset: 0,
      dateColumn: 'sold_at',
      since,
    });
    expect(pg.sql).toBe(
      `SELECT * FROM ${quotePgIdent('erp')}.${quotePgIdent('pedidos')} WHERE ${quotePgIdent('sold_at')} >= $1 LIMIT $2 OFFSET $3`,
    );
    expect(pg.values).toEqual([since, 1000, 0]);

    const mysql = buildSqlFetchQuery({
      dialect: 'mysql',
      schema: 'erp',
      table: 'pedidos',
      limit: 1000,
      offset: 2000,
      dateColumn: 'data_venda',
      since,
    });
    expect(mysql.sql).toBe(
      `SELECT * FROM ${quoteMysqlIdent('erp')}.${quoteMysqlIdent('pedidos')} WHERE ${quoteMysqlIdent('data_venda')} >= ? LIMIT ? OFFSET ?`,
    );
    expect(mysql.values).toEqual([since, 1000, 2000]);
  });
});

describe('syncSqlMappings incremental skip', () => {
  it('does not fetch a fact table when the date column is unmapped', async () => {
    const fetched: string[] = [];
    const result = await syncSqlMappings({
      rawRecords: {
        upsertByKey: async () => ({ created: true, record: { id: '1', checksum: 'x' } }),
      } as never,
      context: {
        tenantId: 't',
        dataSourceId: 'd',
        syncJobId: 's',
        mode: 'incremental',
        since: new Date('2026-06-15T00:00:00.000Z'),
        mappings: [
          {
            sourceEntity: 'pedidos',
            targetEntity: 'sale',
            configuration: { fields: [{ source: 'id', target: 'external_id' }] },
          },
        ],
      },
      fetch: async (resource) => {
        fetched.push(resource);
        return [];
      },
    });
    expect(fetched).toEqual([]);
    expect(result.recordsRead).toBe(0);
    expect(result.skippedMappings).toEqual([
      { sourceEntity: 'pedidos', targetEntity: 'sale', reason: 'incremental_missing_date_column' },
    ]);
  });
});
