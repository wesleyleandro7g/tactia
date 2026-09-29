import { AppError, ErrorCode } from '@tactia/shared';
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
import {
  MAX_ROWS,
  parseWebPortalConfig,
  parseWebPortalCredentials,
  type WebPortalConfig,
  type WebPortalCredentials,
  type WebPortalResource,
} from './web-portal-config';

export type HtmlIngestExtractRequest = {
  tenantId: string;
  dataSourceId: string;
  allowedHosts: string[];
  resource: WebPortalResource;
  login?: WebPortalConfig['login'];
  credentials: WebPortalCredentials;
  adaptive: boolean;
  allowEmpty: boolean;
  limit?: number;
  offset?: number;
};

export type HtmlIngestExtractResult = {
  resource: string;
  rows: RawRow[];
  warnings: string[];
};

export type HtmlIngestClient = {
  health(): Promise<void>;
  extract(input: HtmlIngestExtractRequest): Promise<HtmlIngestExtractResult>;
};

export type WebPortalConnectorConfig = {
  tenantId: string;
  dataSourceId: string;
  recipe: WebPortalConfig;
  credentials?: WebPortalCredentials;
  client?: HtmlIngestClient;
};

export class WebPortalConnector implements Connector {
  private readonly recipe: WebPortalConfig;
  private readonly credentials: WebPortalCredentials;
  private readonly client: HtmlIngestClient;

  constructor(
    private readonly config: WebPortalConnectorConfig,
    private readonly rawRecords?: RawRecordRepository,
  ) {
    this.recipe = config.recipe;
    this.credentials = config.credentials ?? {};
    this.client = config.client ?? defaultHtmlIngestClient();
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.client.health();
      const first = this.recipe.resources[0];
      if (!first) return { success: false, message: 'Nenhum recurso configurado.' };
      const extracted = await this.extractResource(first, 5);
      if (!extracted.rows.length && !first.allowEmpty) {
        return {
          success: false,
          message: extracted.warnings[0] ?? 'Nenhum registro extraído.',
        };
      }
      const warning = extracted.warnings[0];
      return {
        success: true,
        message: warning
          ? `Portal alcançado, com aviso: ${warning}`
          : `Portal alcançado (${extracted.rows.length} linha(s) de amostra).`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  async discover(): Promise<DiscoveryResult> {
    const resources = [];
    for (const resource of this.recipe.resources) {
      const extracted = await this.extractResource(resource, 5);
      const columns = Object.keys(resource.fields).map((name) => ({
        name,
        type: 'string',
        nullable: name !== resource.idField,
      }));
      resources.push({
        name: resource.key,
        columns,
        sampleRows: extracted.rows.slice(0, 5),
      });
    }
    return { resources };
  }

  async fetch(resource: string, options?: FetchOptions): Promise<RawRow[]> {
    const definition = this.recipe.resources.find((item) => item.key === resource);
    if (!definition) {
      throw new AppError(ErrorCode.CONNECTOR_ERROR, `Recurso '${resource}' não existe na receita.`);
    }
    const limit = Math.min(options?.limit ?? MAX_ROWS, MAX_ROWS);
    const offset = options?.offset ?? 0;
    const extracted = await this.extractResource(definition, limit, offset);
    return extracted.rows;
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
          const externalId = String(row['external_id'] ?? '').trim();
          if (!externalId) {
            counters.failed += 1;
            continue;
          }
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

  private extractResource(resource: WebPortalResource, limit: number, offset = 0) {
    return this.client.extract({
      tenantId: this.config.tenantId,
      dataSourceId: this.config.dataSourceId,
      allowedHosts: this.recipe.allowedHosts,
      resource,
      ...(this.recipe.login ? { login: this.recipe.login } : {}),
      credentials: this.credentials,
      adaptive: this.recipe.adaptive,
      allowEmpty: resource.allowEmpty,
      limit,
      offset,
    });
  }
}

export function defaultHtmlIngestClient(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): HtmlIngestClient {
  const baseUrl = (env['HTML_INGEST_URL'] ?? '').replace(/\/$/, '');
  const token = env['HTML_INGEST_TOKEN'] ?? '';

  async function request(path: string, init?: RequestInit): Promise<Response> {
    if (!baseUrl) {
      throw new AppError(ErrorCode.CONNECTOR_ERROR, 'HTML_INGEST_URL is not configured');
    }
    if (!token) {
      throw new AppError(ErrorCode.CONNECTOR_ERROR, 'HTML_INGEST_TOKEN is not configured');
    }
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-html-ingest-token': token,
        ...(init?.headers ?? {}),
      },
    });
    if (response.status === 401 || response.status === 403) {
      throw new AppError(ErrorCode.CONNECTOR_ERROR, 'HTML ingest unauthorized');
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new AppError(ErrorCode.CONNECTOR_ERROR, ingestErrorMessage(response.status, detail));
    }
    return response;
  }

  return {
    async health() {
      await request('/health');
    },
    async extract(input) {
      const response = await request('/internal/html/extract', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const body = (await response.json()) as HtmlIngestExtractResult;
      return {
        resource: typeof body.resource === 'string' ? body.resource : input.resource.key,
        rows: Array.isArray(body.rows) ? body.rows.filter(isRow) : [],
        warnings: Array.isArray(body.warnings)
          ? body.warnings.filter((item): item is string => typeof item === 'string')
          : [],
      };
    },
  };
}

function ingestErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail;
  } catch {
    /* body is not JSON */
  }
  return body.trim() || `HTML ingest HTTP ${status}`;
}

function isRow(value: unknown): value is RawRow {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export { parseWebPortalConfig, parseWebPortalCredentials };
