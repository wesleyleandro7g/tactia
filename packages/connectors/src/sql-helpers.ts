import { applyTransform } from './transforms';
import { computeChecksum } from './checksum';
import { incrementalFetchDecision } from './incremental';
import type {
  DiscoveryColumn,
  DiscoveryResource,
  FetchOptions,
  FieldMapping,
  RawRow,
  SkippedMapping,
  SyncContext,
  SyncResult,
} from './types';
import type { RawRecordRepository } from '@tactia/database';

export const SQL_BATCH_SIZE = 1000;

export type InformationSchemaColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
};

export function quotePgIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function quoteMysqlIdent(value: string): string {
  return `\`${value.replaceAll('`', '``')}\``;
}

export function resourcesFromInformationSchema(rows: InformationSchemaColumnRow[]): DiscoveryResource[] {
  const resourceMap = new Map<string, DiscoveryColumn[]>();
  for (const row of rows) {
    const columns = resourceMap.get(row.table_name) ?? [];
    columns.push({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === 'YES',
    });
    resourceMap.set(row.table_name, columns);
  }

  return Array.from(resourceMap.entries()).map(([name, columns]) => ({ name, columns }));
}

export function normalizeSqlRow(row: RawRow, fieldMappings: FieldMapping[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const mapping of fieldMappings) {
    result[mapping.target] = applyTransform(row[mapping.source], mapping.transform);
  }
  return result;
}

export type SqlFetchQuery = {
  sql: string;
  values: unknown[];
};

export function buildSqlFetchQuery(args: {
  dialect: 'postgres' | 'mysql';
  schema: string;
  table: string;
  limit: number;
  offset: number;
  dateColumn?: string;
  since?: Date;
}): SqlFetchQuery {
  const quote = args.dialect === 'mysql' ? quoteMysqlIdent : quotePgIdent;
  const qualified = `${quote(args.schema)}.${quote(args.table)}`;
  const filter = args.dateColumn && args.since;

  if (args.dialect === 'postgres') {
    if (filter) {
      return {
        sql: `SELECT * FROM ${qualified} WHERE ${quote(args.dateColumn!)} >= $1 LIMIT $2 OFFSET $3`,
        values: [args.since, args.limit, args.offset],
      };
    }
    return {
      sql: `SELECT * FROM ${qualified} LIMIT $1 OFFSET $2`,
      values: [args.limit, args.offset],
    };
  }

  if (filter) {
    return {
      sql: `SELECT * FROM ${qualified} WHERE ${quote(args.dateColumn!)} >= ? LIMIT ? OFFSET ?`,
      values: [args.since, args.limit, args.offset],
    };
  }
  return {
    sql: `SELECT * FROM ${qualified} LIMIT ? OFFSET ?`,
    values: [args.limit, args.offset],
  };
}

export async function syncSqlMappings(args: {
  rawRecords: RawRecordRepository;
  context: SyncContext;
  fetch: (resource: string, options?: FetchOptions) => Promise<RawRow[]>;
  batchSize?: number;
}): Promise<SyncResult> {
  const batchSize = args.batchSize ?? SQL_BATCH_SIZE;
  const counters = { read: 0, created: 0, updated: 0, failed: 0 };
  const skippedMappings: SkippedMapping[] = [];

  for (const mapping of args.context.mappings) {
    const decision = incrementalFetchDecision(
      args.context.mode,
      mapping.targetEntity,
      mapping.configuration?.fields,
    );
    if (!decision.fetch) {
      skippedMappings.push({
        sourceEntity: mapping.sourceEntity,
        targetEntity: mapping.targetEntity,
        reason: decision.reason,
      });
      continue;
    }

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const rows = await args.fetch(mapping.sourceEntity, {
        limit: batchSize,
        offset,
        ...(decision.dateColumn && args.context.since
          ? { dateColumn: decision.dateColumn, since: args.context.since }
          : {}),
      });
      hasMore = rows.length === batchSize;
      offset += rows.length;

      for (const row of rows) {
        counters.read++;
        try {
          const externalId = String(row['id'] ?? row['external_id'] ?? counters.read);
          const checksum = computeChecksum(row as Record<string, unknown>);

          const { created } = await args.rawRecords.upsertByKey({
            tenantId: args.context.tenantId,
            dataSourceId: args.context.dataSourceId,
            syncJobId: args.context.syncJobId,
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

      args.context.onProgress?.(counters);
    }
  }

  return {
    recordsRead: counters.read,
    recordsCreated: counters.created,
    recordsUpdated: counters.updated,
    recordsFailed: counters.failed,
    ...(skippedMappings.length > 0 ? { skippedMappings } : {}),
  };
}
