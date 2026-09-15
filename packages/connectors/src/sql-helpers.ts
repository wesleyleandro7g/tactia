import { applyTransform } from './transforms';
import { computeChecksum } from './checksum';
import type {
  DiscoveryColumn,
  DiscoveryResource,
  FetchOptions,
  FieldMapping,
  RawRow,
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

export async function syncSqlMappings(args: {
  rawRecords: RawRecordRepository;
  context: SyncContext;
  fetch: (resource: string, options?: FetchOptions) => Promise<RawRow[]>;
  batchSize?: number;
}): Promise<SyncResult> {
  const batchSize = args.batchSize ?? SQL_BATCH_SIZE;
  const counters = { read: 0, created: 0, updated: 0, failed: 0 };

  for (const mapping of args.context.mappings) {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const rows = await args.fetch(mapping.sourceEntity, { limit: batchSize, offset });
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
  };
}
