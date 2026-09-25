import { computeChecksum } from '../../checksum';
import type {
  ConnectionTestResult,
  Connector,
  DiscoveryResult,
  FetchOptions,
  FieldMapping,
  RawRow,
  SyncContext,
  SyncResult,
} from '../../types';
import type { RawRecordRepository } from '@tactia/database';
import {
  BrowserExecutionError,
  type BrowserExecutor,
  type BrowserExecutionResult,
} from '../../browser/contracts';
import { assertTorgeModulesEnableable, getTorgeModule, TORGE_MODULES } from './definition';
import {
  parseTorgeProductsCsv,
  validateStructuredTorgeProducts,
  type TorgeProductColumnProfile,
} from './parsers/products';

export type TorgeConnectionConfig = {
  accountScope: string;
  branchScope: string;
  instanceKey: string;
  enabledModules: string[];
  timezone: string;
  dailyTime: string;
  recentWindowDays: number;
  reconciliationWindowDays: number;
  products?: { columnProfile?: TorgeProductColumnProfile };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeScope(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) throw new Error(`Escopo Torge inválido: ${label}.`);
  return normalized;
}

export function parseTorgeConnectionConfig(value: unknown): TorgeConnectionConfig {
  const row = asRecord(value);
  const enabledModules = Array.isArray(row?.['enabledModules'])
    ? row['enabledModules'].filter((item): item is string => typeof item === 'string')
    : [];
  if (enabledModules.length === 0) throw new Error('Selecione ao menos um módulo Torge.');
  const products = asRecord(row?.['products']);
  const timezone = safeScope(String(row?.['timezone'] ?? ''), 'fuso');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error('Fuso Torge inválido.');
  }
  const dailyTime = String(row?.['dailyTime'] ?? '');
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(dailyTime);
  if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59 || Number(timeMatch[2]) % 5 !== 0) {
    throw new Error('Horário diário precisa usar HH:MM em múltiplos de 5 minutos.');
  }
  const dayCount = (key: string) => {
    const value = Number(row?.[key]);
    if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error(`Política Torge inválida: ${key}.`);
    return value;
  };
  return {
    accountScope: safeScope(String(row?.['accountScope'] ?? ''), 'conta'),
    branchScope: safeScope(String(row?.['branchScope'] ?? ''), 'filial'),
    instanceKey: safeScope(String(row?.['instanceKey'] ?? ''), 'instância'),
    enabledModules,
    timezone,
    dailyTime,
    recentWindowDays: dayCount('recentWindowDays'),
    reconciliationWindowDays: dayCount('reconciliationWindowDays'),
    ...(products?.['columnProfile'] ? { products: { columnProfile: products['columnProfile'] as TorgeProductColumnProfile } } : {}),
  };
}

function scopedExternalId(config: TorgeConnectionConfig, sourceId: string): string {
  return `${encodeURIComponent(config.accountScope)}|${encodeURIComponent(config.branchScope)}|${sourceId}`;
}

function executionMessage(error: unknown): { code: string; message: string; retryable: boolean; status: 'failed' | 'needs_attention' | 'cancelled' } {
  if (error instanceof BrowserExecutionError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      status: error.status === 'needs_attention' ? 'needs_attention' : error.status === 'cancelled' ? 'cancelled' : 'failed',
    };
  }
  const candidate = error as { code?: unknown };
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : 'TORGE_MODULE_FAILED',
    message: error instanceof Error ? error.message : 'Falha na coleta do módulo.',
    retryable: false,
    status: 'failed',
  };
}

export class TorgeConnector implements Connector {
  constructor(
    private readonly connectionId: string,
    private readonly credentialRef: string,
    private readonly config: TorgeConnectionConfig,
    private readonly browser: BrowserExecutor,
    private readonly rawRecords?: RawRecordRepository,
  ) {
    assertTorgeModulesEnableable(config.enabledModules);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const health = await this.browser.health();
    return {
      success: health.healthy,
      message: health.healthy
        ? 'Executor disponível. O login e o escopo serão verificados em trabalho durável antes da habilitação.'
        : health.safeMessage,
      details: {
        engine: this.browser.engine,
        instanceKey: this.browser.instanceKey,
        accountScope: this.config.accountScope,
        branchScope: this.config.branchScope,
        loginVerified: false,
      },
    };
  }

  async discover(): Promise<DiscoveryResult> {
    return {
      resources: TORGE_MODULES.map((module) => ({
        name: module.id,
        columns: module.id === 'products' ? [
          { name: 'external_id', type: 'string', nullable: false },
          { name: 'name', type: 'string', nullable: false },
          { name: 'sku', type: 'string', nullable: true },
          { name: 'price', type: 'decimal', nullable: true },
          { name: 'cost', type: 'decimal', nullable: true },
          { name: 'status', type: 'string', nullable: true },
        ] : [],
        sampleRows: [{ moduleStatus: module.status, limitations: module.limitations }],
      })),
    };
  }

  async fetch(resource: string, _options?: FetchOptions): Promise<RawRow[]> {
    const result = await this.collect(resource, `preview-${Date.now()}`);
    if (result.status !== 'succeeded') throw new Error(result.safeMessage || 'Coleta Torge não concluída.');
    return result.rows;
  }

  normalize(row: RawRow, fieldMappings: FieldMapping[]): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    for (const field of fieldMappings) normalized[field.target] = row[field.source];
    return normalized;
  }

  async sync(context: SyncContext): Promise<SyncResult> {
    if (!this.rawRecords) throw new Error('RawRecordRepository required for sync');
    const counters = { read: 0, created: 0, updated: 0, failed: 0 };
    const moduleResults: NonNullable<SyncResult['moduleResults']> = [];
    const enabled = new Set(this.config.enabledModules);

    for (const mapping of context.mappings) {
      if (!enabled.has(mapping.sourceEntity)) continue;
      const module = getTorgeModule(mapping.sourceEntity);
      if (!module || module.status !== 'implemented') continue;
      await context.onModuleStart?.({
        moduleKey: module.id,
        workflowKey: module.workflowKey!,
        workflowVersion: module.workflowVersion!,
        parserVersion: module.parserVersion!,
      });
      const executionKey = `${context.syncJobId}-${module.id}`;
      try {
        const collected = await this.collect(module.id, executionKey, context.onArtifact);
        if (collected.status !== 'succeeded') {
          const status = collected.status === 'needs_attention' ? 'needs_attention' : collected.status === 'cancelled' ? 'cancelled' : 'failed';
          const failed = {
            moduleKey: module.id,
            status,
            recordsRead: 0,
            recordsFailed: 0,
            externalExecutionId: collected.externalExecutionId,
            errorCode: collected.errorCode,
            safeMessage: collected.safeMessage,
            retryable: false,
            workflowKey: module.workflowKey!, workflowVersion: module.workflowVersion!, parserVersion: module.parserVersion!,
          } as const;
          moduleResults.push(failed);
          await context.onModuleFinish?.(failed);
          continue;
        }

        for (const row of collected.rows) {
          counters.read += 1;
          const sourceId = String(row['external_id'] ?? '');
          const payload = { ...row, external_id: scopedExternalId(this.config, sourceId) };
          const { created } = await this.rawRecords.upsertByKey({
            tenantId: context.tenantId,
            dataSourceId: context.dataSourceId,
            syncJobId: context.syncJobId,
            externalId: payload.external_id,
            entityType: mapping.targetEntity,
            payload,
            checksum: computeChecksum(payload),
          });
          if (created) counters.created += 1;
          else counters.updated += 1;
        }
        const succeeded = {
          moduleKey: module.id,
          status: 'succeeded' as const,
          recordsRead: collected.rows.length,
          recordsFailed: 0,
          externalExecutionId: collected.externalExecutionId,
          artifactRefs: collected.artifactRefs.map((item) => item.ref),
          evidence: collected.evidence,
          retryable: false,
          workflowKey: module.workflowKey!, workflowVersion: module.workflowVersion!, parserVersion: module.parserVersion!,
        };
        moduleResults.push(succeeded);
        await context.onModuleFinish?.(succeeded);
      } catch (error) {
        counters.failed += 1;
        const failure = executionMessage(error);
        const failed = {
          moduleKey: module.id,
          status: failure.status,
          recordsRead: 0,
          recordsFailed: 1,
          errorCode: failure.code,
          safeMessage: failure.message,
          retryable: failure.retryable,
          workflowKey: module.workflowKey!, workflowVersion: module.workflowVersion!, parserVersion: module.parserVersion!,
        };
        moduleResults.push(failed);
        await context.onModuleFinish?.(failed);
      }
    }

    context.onProgress?.(counters);
    return { recordsRead: counters.read, recordsCreated: counters.created, recordsUpdated: counters.updated, recordsFailed: counters.failed, moduleResults };
  }

  private async collect(
    moduleId: string,
    executionKey: string,
    onArtifact?: SyncContext['onArtifact'],
  ): Promise<BrowserExecutionResult & { rows: RawRow[]; evidence: Record<string, unknown> }> {
    const module = getTorgeModule(moduleId);
    if (!module || module.status !== 'implemented' || !module.workflowKey || !module.workflowVersion) {
      throw new Error(`Módulo Torge não habilitável: ${moduleId}.`);
    }
    const result = await this.browser.execute({
      executionKey,
      connectionId: this.connectionId,
      sessionScope: `torge-${this.connectionId}`,
      workflowKey: module.workflowKey,
      workflowVersion: module.workflowVersion,
      parameters: { accountScope: this.config.accountScope, branchScope: this.config.branchScope, includeInactive: true },
      credentialRefs: [this.credentialRef],
      deadlineAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
    });
    if (result.status !== 'succeeded') return { ...result, rows: [], evidence: {} };

    if (moduleId !== 'products') throw new Error(`Parser Torge ausente: ${moduleId}.`);
    const root = asRecord(result.data);
    let rows: RawRow[];
    if (typeof result.data === 'string') {
      const profile = this.config.products?.columnProfile;
      if (!profile) throw new Error('TORGE_PRODUCTS_PROFILE_REQUIRED: perfil de colunas não configurado.');
      rows = parseTorgeProductsCsv(Buffer.from(result.data, 'utf8'), profile);
    } else if (result.artifactRefs.length > 0) {
      const profile = this.config.products?.columnProfile;
      if (!profile) throw new Error('TORGE_PRODUCTS_PROFILE_REQUIRED: perfil de colunas não configurado.');
      const artifactRef = result.artifactRefs[0]!;
      const artifact = await this.browser.fetchArtifact(artifactRef);
      await onArtifact?.({
        moduleKey: moduleId,
        originRef: artifactRef.ref,
        fileName: artifact.fileName,
        contentType: artifact.contentType,
        body: artifact.body,
      });
      rows = parseTorgeProductsCsv(artifact.body, profile);
    } else {
      rows = validateStructuredTorgeProducts(result.data);
    }

    const sourceTotal = typeof root?.['sourceTotal'] === 'number' ? root['sourceTotal'] : null;
    const complete = root?.['complete'] === true;
    if (!complete || sourceTotal === null || sourceTotal !== rows.length) {
      throw new Error('TORGE_PRODUCTS_INCOMPLETE: total/completude da origem não confere com a coleta.');
    }
    return {
      ...result,
      rows,
      evidence: { complete: true, sourceTotal, uniqueIdentities: rows.length, scope: { account: this.config.accountScope, branch: this.config.branchScope } },
    };
  }
}
