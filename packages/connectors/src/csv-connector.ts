import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { parse } from 'csv-parse';
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

export type CsvConnectorConfig = {
  filePath: string;
};

export class CsvConnector implements Connector {
  constructor(
    private readonly config: CsvConnectorConfig,
    private readonly rawRecords?: RawRecordRepository,
  ) {}

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await readFile(this.config.filePath);
      return { success: true, message: 'File accessible' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Cannot read file: ${message}` };
    }
  }

  async discover(): Promise<DiscoveryResult> {
    const rows = await this._parseAll();
    if (rows.length === 0) {
      return { resources: [{ name: 'data', columns: [], sampleRows: [] }] };
    }

    const headers = Object.keys(rows[0]!);
    const columns = headers.map((h) => ({ name: h, type: 'string', nullable: true }));
    const sampleRows = rows.slice(0, 5);

    return {
      resources: [
        {
          name: 'data',
          columns,
          sampleRows,
        },
      ],
    };
  }

  async fetch(_resource: string, options?: FetchOptions): Promise<RawRow[]> {
    const rows = await this._parseAll();
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
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
      const rows = await this.fetch(mapping.sourceEntity);

      for (const row of rows) {
        counters.read++;
        try {
          const normalized = this.normalize(row, mapping.configuration.fields);
          const externalId = String(row['external_id'] ?? row['id'] ?? counters.read);
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

          // Mark the normalized data on the raw record (via externalId)
          void normalized; // will be used by normalizer
          if (created) counters.created++;
          else counters.updated++;
        } catch {
          counters.failed++;
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

  private async _parseAll(): Promise<RawRow[]> {
    return new Promise((resolve, reject) => {
      const rows: RawRow[] = [];
      const stream = createReadStream(this.config.filePath);
      const parser = parse({ columns: true, skip_empty_lines: true, trim: true });

      stream.pipe(parser);
      parser.on('data', (row: RawRow) => rows.push(row));
      parser.on('end', () => resolve(rows));
      parser.on('error', reject);
      stream.on('error', reject);
    });
  }
}
