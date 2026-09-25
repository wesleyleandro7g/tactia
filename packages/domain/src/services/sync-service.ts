import type {
  ActivityRepository,
  CampaignRepository,
  CredentialRepository,
  CustomerRepository,
  DataQualityReportRepository,
  DataSourceRepository,
  ExpenseRepository,
  ImportRepository,
  InteractionRepository,
  InventoryLevelRepository,
  IntegrationArtifactRepository,
  IntegrationModuleRunRepository,
  LeadRepository,
  MappingRepository,
  PaymentRepository,
  ProductRepository,
  RawRecordRepository,
  SaleRepository,
  SellerRepository,
  SyncJobRepository,
  SyncJobMode,
  SyncJobTrigger,
} from '@tactia/database';
import { createHash } from 'node:crypto';
import { AppError, ErrorCode, isAppError, logger, extFromFileName, maxBytesForKind, storageKey, type ObjectStorage, type RequestContext } from '@tactia/shared';
import {
  canonicalEntityRank,
  CsvConnector,
  McpConnector,
  TorgeConnector,
  createFigraniumExecutorFromEnv,
  createFigraniumExecutorFromResolved,
  parseTorgeConnectionConfig,
  type BrowserCredentialResolver,
  extractCustomData,
  incrementalLookbackSince,
  normalizeRow,
  normalizeToCanonical,
  runDataQualityChecks,
  sqlConnectorFromSource,
  type FieldMapping,
  type MappingConfig,
  type QualityIssue,
  type SyncMode,
} from '@tactia/connectors';
import { assertTenantContext } from '../authz';
import { AuditAction, type AuditLogService } from './audit-log-service';
import { decrypt } from './credential-service';
import type { BrowserIntegrationService, BrowserSyncSnapshot } from './browser-integration-service';
import type { CustomDataValidationService } from './custom-data-validation-service';

export type SyncServiceDeps = {
  dataSources: DataSourceRepository;
  syncJobs: SyncJobRepository;
  rawRecords: RawRecordRepository;
  imports: ImportRepository;
  qualityReports: DataQualityReportRepository;
  moduleRuns?: IntegrationModuleRunRepository;
  artifacts?: IntegrationArtifactRepository;
  objectStorage?: ObjectStorage;
  maxSyncAttempts?: number;
  /**
   * Resolves browser executor instances DB-first (with env fallback) and
   * rebuilds them from an immutable snapshot on retries. When absent, the
   * legacy env-only path is used.
   */
  browserIntegration?: BrowserIntegrationService;
  mappings: MappingRepository;
  credentials: CredentialRepository;
  auditLogs: AuditLogService;
  /** Canonical repositories used by the normalize → upsert step (spec §37). */
  customers: CustomerRepository;
  products: ProductRepository;
  sellers: SellerRepository;
  sales: SaleRepository;
  interactions: InteractionRepository;
  leads: LeadRepository;
  activities: ActivityRepository;
  expenses: ExpenseRepository;
  payments: PaymentRepository;
  inventoryLevels: InventoryLevelRepository;
  campaigns: CampaignRepository;
  /**
   * Classifies and embeds interactions written in this sync. Failures here
   * never fail the sync — the intelligence hook still runs afterwards.
   */
  enrichInteractions?: (event: {
    tenantId: string;
    dataSourceId: string;
    syncJobId: string;
  }) => Promise<void>;
  /**
   * Called after a sync completes successfully. Wired in `apps/web` to the
   * intelligence pipeline so an import produces insights without a manual step
   * (spec §2). Failures here never fail the sync.
   */
  onSyncCompleted?: (event: {
    tenantId: string;
    dataSourceId: string;
    syncJobId: string;
    userId: string | null;
  }) => Promise<void>;
  /**
   * When set, `startSync` enqueues the job instead of running it inline
   * (pg-boss in production). The worker calls `executeSync`.
   */
  enqueueSync?: (job: {
    tenantId: string;
    syncJobId: string;
    requestId: string;
    userId: string | null;
    timezone?: string;
    now?: string;
  }) => Promise<void>;
  customData?: CustomDataValidationService;
};

/** Raw records are normalized in pages to keep memory flat on large imports. */
const NORMALIZE_PAGE_SIZE = 500;

export type StartSyncOptions = {
  mode?: SyncJobMode;
  trigger?: SyncJobTrigger;
  timezone?: string;
  now?: Date;
  idempotencyKey?: string;
};

export type SyncTenantSourcesOptions = {
  now?: Date;
  timezone?: string;
  requestId?: string;
};

type EntityOutcome = {
  entityType: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  issues: QualityIssue[];
  normalized: Record<string, unknown>[];
};

class RetryableSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableSyncError';
  }
}

export class SyncService {
  constructor(private readonly deps: SyncServiceDeps) {}

  async startSync(ctx: RequestContext, dataSourceId: string, options: StartSyncOptions = {}) {
    if (ctx.operatorId) {
      if (!ctx.tenantId) {
        throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
      }
    } else {
      assertTenantContext(ctx);
    }
    const tenantId = ctx.tenantId!;
    const ds = await this.deps.dataSources.findById({ tenantId, id: dataSourceId });
    if (!ds) throw new AppError(ErrorCode.NOT_FOUND, 'DataSource not found');
    if (ds.type === 'torge' && ds.status !== 'active') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'A conexão Torge precisa estar habilitada.');
    }
    if (ds.type === 'torge' && !this.deps.enqueueSync) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Integrações por navegador exigem JOBS_ENABLED=true.');
    }

    const exclusive = await this.deps.syncJobs.createExclusive({
      tenantId,
      dataSourceId,
      status: 'pending',
      mode: options.mode ?? 'full',
      trigger: options.trigger ?? 'manual',
      idempotencyKey: options.idempotencyKey ?? null,
      configSnapshot: await this.buildBrowserSnapshot(ctx, ds),
    });
    const job = exclusive.job;
    if (!exclusive.created) return job;

    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.SYNC_STARTED,
      entityType: 'sync_job',
      entityId: job.id,
      metadata: { dataSourceId },
    });

    const meta = {
      requestId: ctx.requestId,
      userId: ctx.userId ?? null,
      timezone: options.timezone,
      now: options.now,
    };
    if (this.deps.enqueueSync) {
      await this.deps.enqueueSync({
        tenantId,
        syncJobId: job.id,
        requestId: meta.requestId,
        userId: meta.userId,
        timezone: options.timezone,
        now: options.now?.toISOString(),
      });
    } else {
      await this.executeSync(tenantId, job.id, meta);
    }

    return this.deps.syncJobs.findById({ tenantId, id: job.id });
  }

  async getSyncJob(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const job = await this.deps.syncJobs.findById({ tenantId: ctx.tenantId!, id });
    if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'SyncJob not found');
    return job;
  }

  async listSyncJobs(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const page = parseInt(query['page'] ?? '1', 10);
    const pageSize = parseInt(query['pageSize'] ?? '20', 10);
    const skip = (page - 1) * pageSize;
    const result = await this.deps.syncJobs.list({
      tenantId: ctx.tenantId!,
      dataSourceId: query['dataSourceId'],
      skip,
      take: pageSize,
    });
    return { ...result, pagination: { page, pageSize } };
  }

  async cancelSyncJob(ctx: RequestContext, id: string) {
    if (ctx.operatorId) {
      if (!ctx.tenantId) throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
    } else {
      assertTenantContext(ctx);
    }
    const job = await this.deps.syncJobs.findById({ tenantId: ctx.tenantId!, id });
    if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'SyncJob not found');
    if (job.status !== 'pending' && job.status !== 'running') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Only pending or running sync jobs can be cancelled');
    }
    const cancelled = await this.deps.syncJobs.updateStatus({ id, status: 'cancelled', finishedAt: new Date() });
    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.SYNC_CANCELLED,
      entityType: 'sync_job',
      entityId: id,
      metadata: { dataSourceId: job.dataSourceId },
    });
    return cancelled;
  }

  async enqueueDueBrowserSyncs(now = new Date()): Promise<{ enqueued: number }> {
    if (!this.deps.enqueueSync) return { enqueued: 0 };
    const sources = await this.deps.dataSources.listActiveBrowserForSchedule();
    let enqueued = 0;
    for (const source of sources) {
      try {
        const config = parseTorgeConnectionConfig(source.configuration);
        const local = localScheduleParts(now, config.timezone);
        if (local.time < config.dailyTime) continue;
        const exclusive = await this.deps.syncJobs.createExclusive({
          tenantId: source.tenantId,
          dataSourceId: source.id,
          status: 'pending',
          mode: 'incremental',
          trigger: 'scheduled',
          idempotencyKey: `torge-daily:${source.id}:${local.dateKey}`,
        });
        if (!exclusive.created) continue;
        await this.deps.enqueueSync({
          tenantId: source.tenantId,
          syncJobId: exclusive.job.id,
          requestId: `torge-daily-${local.dateKey}`,
          userId: null,
          timezone: config.timezone,
          now: now.toISOString(),
        });
        enqueued += 1;
      } catch (error) {
        logger.error({
          tenant_id: source.tenantId,
          data_source_id: source.id,
          operation: 'torge_schedule',
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { enqueued };
  }

  /**
   * Daily path: SQL sources only, incremental, inline (must finish before insights).
   * CSV/MCP are skipped. A failed source does not abort the others.
   */
  async syncTenantSources(tenantId: string, options: SyncTenantSourcesOptions = {}) {
    const sources = await this.deps.dataSources.listActiveForSync(tenantId);
    const ranked: Array<{ id: string; rank: number }> = [];

    for (const source of sources) {
      const mappings = await this.deps.mappings.findByDataSource({
        tenantId,
        dataSourceId: source.id,
        activeOnly: true,
      });
      if (mappings.length === 0) continue;
      ranked.push({
        id: source.id,
        rank: Math.min(...mappings.map((mapping) => canonicalEntityRank(mapping.targetEntity))),
      });
    }

    ranked.sort((a, b) => a.rank - b.rank);

    const jobs = [];
    for (const item of ranked) {
      const job = await this.deps.syncJobs.create({
        tenantId,
        dataSourceId: item.id,
        status: 'pending',
        mode: 'incremental',
        trigger: 'scheduled',
      });
      await this.executeSync(tenantId, job.id, {
        requestId: options.requestId,
        userId: null,
        timezone: options.timezone,
        now: options.now,
      });
      jobs.push(await this.deps.syncJobs.findById({ tenantId, id: job.id }));
    }
    return jobs;
  }

  /**
   * Full lifecycle (spec §37): fetch → raw → normalize → upsert canônico →
   * data quality → import. Counters on the `SyncJob` report canonical results:
   * `recordsRead` are the rows read from the source, `recordsCreated/Updated`
   * are the canonical entities written, `recordsFailed` are the rows that could
   * not be normalized (each with a reason in the DataQualityReport).
   */
  async executeSync(
    tenantId: string,
    syncJobId: string,
    meta: {
      requestId?: string;
      userId?: string | null;
      timezone?: string;
      now?: Date | string;
    } = {},
  ): Promise<void> {
    const started = Date.now();
    const requestId = meta.requestId;
    let dataSourceId: string | null = null;

    const existingJob = await this.deps.syncJobs.findById({ tenantId, id: syncJobId });
    if (!existingJob) throw new AppError(ErrorCode.NOT_FOUND, 'SyncJob not found');
    if (['completed', 'partial', 'failed', 'cancelled', 'needs_attention'].includes(existingJob.status)) return;

    await this.deps.syncJobs.updateStatus({
      id: syncJobId,
      status: 'running',
      startedAt: new Date(),
    });

    try {
      const job = await this.deps.syncJobs.findById({ tenantId, id: syncJobId });
      if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'SyncJob not found');
      dataSourceId = job.dataSourceId;

      const ds = await this.deps.dataSources.findById({ tenantId, id: job.dataSourceId });
      if (!ds) throw new AppError(ErrorCode.NOT_FOUND, 'DataSource not found');

      const activeMappings = await this.deps.mappings.findByDataSource({
        tenantId,
        dataSourceId: ds.id,
        activeOnly: true,
      });
      if (activeMappings.length === 0) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'A fonte de dados não tem nenhum mapeamento ativo',
        );
      }

      const syncContextMappings = activeMappings.map((m) => ({
        sourceEntity: m.sourceEntity,
        targetEntity: m.targetEntity,
        configuration: m.configuration as unknown as MappingConfig,
      }));

      const connector = await this.buildConnector(tenantId, ds, job.configSnapshot ?? null);
      const mode: SyncMode = job.mode === 'incremental' ? 'incremental' : 'full';
      const clock =
        meta.now instanceof Date ? meta.now : meta.now ? new Date(meta.now) : new Date();
      const since =
        mode === 'incremental'
          ? incrementalLookbackSince(clock, meta.timezone ?? 'America/Sao_Paulo')
          : undefined;

      const moduleRunIds = new Map<string, string>();
      const moduleAttempts = new Map<string, number>();
      if (ds.type === 'torge' && (!this.deps.moduleRuns || !this.deps.artifacts || !this.deps.objectStorage)) {
        throw new AppError(ErrorCode.INTERNAL_ERROR, 'Persistência de integração por navegador não configurada.');
      }

      // 1. Source → RawRecord (originals preserved, spec §3.3)
      const raw = await connector.sync({
        tenantId,
        dataSourceId: ds.id,
        syncJobId,
        mappings: syncContextMappings,
        mode,
        ...(since ? { since } : {}),
        onModuleStart: this.deps.moduleRuns
          ? async (module) => {
              const run = await this.deps.moduleRuns!.start({
                tenantId,
                dataSourceId: ds.id,
                syncJobId,
                moduleKey: module.moduleKey,
                workflowKey: module.workflowKey,
                workflowVersion: module.workflowVersion,
                parserVersion: module.parserVersion,
                leaseOwner: `${syncJobId}-${module.moduleKey}`,
                leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
                externalExecutionId: `${syncJobId}-${module.moduleKey}`,
              });
              moduleRunIds.set(module.moduleKey, run.id);
              moduleAttempts.set(module.moduleKey, run.attempt);
            }
          : undefined,
        onArtifact: this.deps.artifacts && this.deps.objectStorage
          ? async (artifact) => {
              const moduleRunId = moduleRunIds.get(artifact.moduleKey);
              if (!moduleRunId) throw new Error('Execução de módulo ausente para artefato.');
              const max = maxBytesForKind('integration-artifact');
              if (artifact.body.length > max) throw new Error('Artefato de integração excede 100 MiB.');
              const checksum = createHash('sha256').update(artifact.body).digest('hex');
              const key = storageKey({
                tenantId,
                kind: 'integration-artifact',
                id: `${moduleRunId}-${checksum.slice(0, 12)}`,
                ext: extFromFileName(artifact.fileName),
              });
              await this.deps.objectStorage!.put({ key, body: artifact.body, contentType: artifact.contentType });
              await this.deps.artifacts!.upsert({
                tenantId,
                dataSourceId: ds.id,
                moduleRunId,
                origin: artifact.originRef,
                moduleKey: artifact.moduleKey,
                checksum,
                mimeType: artifact.contentType,
                storageKey: key,
                byteSize: artifact.body.length,
                retentionUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              });
            }
          : undefined,
        onModuleFinish: this.deps.moduleRuns
          ? async (module) => {
              await this.deps.moduleRuns!.finish({
                syncJobId,
                moduleKey: module.moduleKey,
                status: module.status,
                recordsRead: module.recordsRead,
                recordsFailed: module.recordsFailed,
                externalExecutionId: module.externalExecutionId ?? `${syncJobId}-${module.moduleKey}`,
                evidence: module.evidence,
                checkpoint: undefined,
                errorCode: module.errorCode,
                safeMessage: module.safeMessage,
                retryable: module.retryable,
              });
            }
          : undefined,
        onProgress: async (counters) => {
          await this.deps.syncJobs.updateCounters({
            id: syncJobId,
            recordsRead: counters.read,
            recordsCreated: 0,
            recordsUpdated: 0,
            recordsFailed: counters.failed,
          });
        },
      });

      const cancellationCheck = await this.deps.syncJobs.findById({ tenantId, id: syncJobId });
      if (cancellationCheck?.status === 'cancelled') {
        logger.info({ tenant_id: tenantId, data_source_id: ds.id, sync_job_id: syncJobId, operation: 'sync_cancelled_before_publish' });
        return;
      }
      if (
        raw.moduleResults?.length &&
        raw.moduleResults.every((module) => module.status !== 'succeeded') &&
        raw.moduleResults.some(
          (module) => module.retryable && (moduleAttempts.get(module.moduleKey) ?? 1) < (this.deps.maxSyncAttempts ?? 4),
        )
      ) {
        throw new RetryableSyncError('Falha transitória na coleta por navegador.');
      }

      for (const skipped of raw.skippedMappings ?? []) {
        await this.deps.qualityReports.create({
          tenantId,
          dataSourceId: ds.id,
          syncJobId,
          entityType: skipped.targetEntity,
          totalRecords: 0,
          validRecords: 0,
          invalidRecords: 0,
          warnings: [],
          errors: [
            {
              rule: skipped.reason,
              count: 1,
              sample: skipped.sourceEntity,
            },
          ],
        });
      }

      const skippedTargets = new Set((raw.skippedMappings ?? []).map((item) => item.targetEntity));
      const failedModules = new Set((raw.moduleResults ?? []).filter((item) => item.status !== 'succeeded').map((item) => item.moduleKey));

      // 2. RawRecord → normalize → canonical upsert, in dependency order
      const fieldsByEntity = mergeFieldsByTargetEntity(
        syncContextMappings.filter(
          (mapping) => !skippedTargets.has(mapping.targetEntity) && !failedModules.has(mapping.sourceEntity),
        ),
      );
      const entityTypes = [...fieldsByEntity.keys()].sort(
        (a, b) => canonicalEntityRank(a) - canonicalEntityRank(b),
      );

      const outcomes: EntityOutcome[] = [];
      for (const entityType of entityTypes) {
        outcomes.push(
          await this.normalizeEntity({
            tenantId,
            dataSourceId: ds.id,
            entityType,
            fields: fieldsByEntity.get(entityType)!,
            unprocessedOnly: mode === 'incremental',
          }),
        );
      }

      // 3. Data quality over the *normalized* records (spec §56) + Import row
      for (const outcome of outcomes) {
        const quality = runDataQualityChecks(outcome.entityType, outcome.normalized);
        const errors = [...quality.errors, ...outcome.issues];
        const invalidRecords = Math.max(quality.invalidRecords, outcome.skipped);

        await this.deps.qualityReports.create({
          tenantId,
          dataSourceId: ds.id,
          syncJobId,
          entityType: outcome.entityType,
          totalRecords: outcome.total,
          validRecords: outcome.total - invalidRecords,
          invalidRecords,
          warnings: quality.warnings,
          errors,
        });

        const importRow = await this.deps.imports.create({
          tenantId,
          dataSourceId: ds.id,
          syncJobId,
          entityType: outcome.entityType,
          totalRecords: outcome.total,
          idempotencyKey: `${syncJobId}:${outcome.entityType}`,
        });
        const processed = outcome.created + outcome.updated;
        await this.deps.imports.updateCounters({
          id: importRow.id,
          processedRecords: processed,
          failedRecords: outcome.skipped,
          // No `partial` in ImportStatus: an import that wrote nothing while
          // having rows is a failure; anything else is completed with counters.
          status: outcome.total > 0 && processed === 0 ? 'failed' : 'completed',
        });
      }

      const totals = outcomes.reduce(
        (acc, outcome) => ({
          created: acc.created + outcome.created,
          updated: acc.updated + outcome.updated,
          skipped: acc.skipped + outcome.skipped,
        }),
        { created: 0, updated: 0, skipped: 0 },
      );

      const moduleResults = raw.moduleResults ?? [];
      const succeededModules = moduleResults.filter((module) => module.status === 'succeeded');
      const unfinishedModules = moduleResults.filter((module) => module.status !== 'succeeded');
      const finalStatus = unfinishedModules.length === 0
        ? 'completed'
        : succeededModules.length > 0
          ? 'partial'
          : unfinishedModules.every((module) => module.status === 'needs_attention')
            ? 'needs_attention'
            : unfinishedModules.every((module) => module.status === 'cancelled')
              ? 'cancelled'
              : 'failed';

      await this.deps.syncJobs.updateCounters({
        id: syncJobId,
        recordsRead: raw.recordsRead,
        recordsCreated: totals.created,
        recordsUpdated: totals.updated,
        recordsFailed: raw.recordsFailed + totals.skipped,
      });
      await this.deps.syncJobs.updateStatus({
        id: syncJobId,
        status: finalStatus,
        finishedAt: new Date(),
      });
      if (finalStatus === 'completed') {
        await this.deps.dataSources.updateLastSyncAt({ id: ds.id, lastSyncAt: new Date() });
      }
      if (this.deps.moduleRuns && (finalStatus === 'completed' || finalStatus === 'partial')) {
        for (const module of succeededModules) {
          await this.deps.moduleRuns.markPublished({
            syncJobId,
            moduleKey: module.moduleKey,
            checkpoint: { publishedAt: new Date().toISOString(), evidence: module.evidence ?? {} },
          });
        }
      }

      if (this.deps.enrichInteractions && outcomes.some((outcome) => outcome.entityType === 'interaction')) {
        try {
          await this.deps.enrichInteractions({
            tenantId,
            dataSourceId: ds.id,
            syncJobId,
          });
        } catch (error) {
          logger.warn({
            ...(requestId ? { request_id: requestId } : {}),
            tenant_id: tenantId,
            operation: 'sync_enrich_interactions',
            sync_job_id: syncJobId,
            status: 'failed',
            error: isAppError(error) ? error.code : ErrorCode.INTERNAL_ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const summary = {
        recordsRead: raw.recordsRead,
        recordsCreated: totals.created,
        recordsUpdated: totals.updated,
        recordsFailed: raw.recordsFailed + totals.skipped,
        status: finalStatus,
        modules: moduleResults.map((module) => ({
          moduleKey: module.moduleKey,
          status: module.status,
          recordsRead: module.recordsRead,
          recordsFailed: module.recordsFailed,
          errorCode: module.errorCode,
        })),
        entities: outcomes.map((outcome) => ({
          entityType: outcome.entityType,
          created: outcome.created,
          updated: outcome.updated,
          skipped: outcome.skipped,
        })),
      };

      await this.deps.auditLogs.record(
        { tenantId, userId: meta.userId ?? null },
        {
          action: finalStatus === 'completed' || finalStatus === 'partial' ? AuditAction.SYNC_COMPLETED : AuditAction.SYNC_FAILED,
          entityType: 'sync_job',
          entityId: syncJobId,
          actorType: 'system',
          metadata: summary,
        },
      );

      // Observability (spec §47)
      logger.info({
        ...(requestId ? { request_id: requestId } : {}),
        tenant_id: tenantId,
        user_id: meta.userId ?? null,
        operation: 'sync',
        data_source_id: ds.id,
        sync_job_id: syncJobId,
        records: raw.recordsRead,
        records_created: totals.created,
        records_updated: totals.updated,
        records_failed: raw.recordsFailed + totals.skipped,
        duration_ms: Date.now() - started,
        status: finalStatus,
      });

      if (
        this.deps.onSyncCompleted &&
        (finalStatus === 'completed' || finalStatus === 'partial') &&
        (job.trigger !== 'scheduled' || ds.type === 'torge')
      ) {
        try {
          await this.deps.onSyncCompleted({
            tenantId,
            dataSourceId: ds.id,
            syncJobId,
            userId: meta.userId ?? null,
          });
        } catch (error) {
          logger.error({
            ...(requestId ? { request_id: requestId } : {}),
            tenant_id: tenantId,
            operation: 'sync_post_hook',
            sync_job_id: syncJobId,
            status: 'failed',
            error: isAppError(error) ? error.code : ErrorCode.INTERNAL_ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (err) {
      if (err instanceof RetryableSyncError) {
        await this.deps.syncJobs.updateStatus({
          id: syncJobId,
          status: 'pending',
          error: 'CONNECTOR_ERROR: falha transitória; aguardando nova tentativa.',
        });
        logger.warn({
          ...(requestId ? { request_id: requestId } : {}),
          tenant_id: tenantId,
          ...(dataSourceId ? { data_source_id: dataSourceId } : {}),
          sync_job_id: syncJobId,
          operation: 'sync_retry_scheduled',
          status: 'pending',
        });
        throw err;
      }
      const code = isAppError(err) ? err.code : ErrorCode.SYNC_ERROR;
      const detail = err instanceof Error ? err.message : String(err);
      // Stored classified and without stack trace (spec §48).
      const message = `${code}: ${detail}`;

      await this.deps.syncJobs.updateStatus({
        id: syncJobId,
        status: 'failed',
        finishedAt: new Date(),
        error: message,
      });

      await this.deps.auditLogs.record(
        { tenantId, userId: meta.userId ?? null },
        {
          action: AuditAction.SYNC_FAILED,
          entityType: 'sync_job',
          entityId: syncJobId,
          actorType: 'system',
          metadata: { error: message, ...(dataSourceId ? { dataSourceId } : {}) },
        },
      );

      logger.error({
        ...(requestId ? { request_id: requestId } : {}),
        tenant_id: tenantId,
        user_id: meta.userId ?? null,
        operation: 'sync',
        ...(dataSourceId ? { data_source_id: dataSourceId } : {}),
        sync_job_id: syncJobId,
        duration_ms: Date.now() - started,
        status: 'failed',
        error: code,
        message: detail,
      });
    }
  }

  // -------------------------------------------------------------------------

  /** Reads raw records of one entity type and upserts them into the canonical model. */
  private async normalizeEntity(input: {
    tenantId: string;
    dataSourceId: string;
    entityType: string;
    fields: FieldMapping[];
    unprocessedOnly?: boolean;
  }): Promise<EntityOutcome> {
    const { tenantId, dataSourceId, entityType, fields, unprocessedOnly } = input;
    const repositories = {
      customers: this.deps.customers,
      products: this.deps.products,
      sellers: this.deps.sellers,
      sales: this.deps.sales,
      interactions: this.deps.interactions,
      leads: this.deps.leads,
      activities: this.deps.activities,
      expenses: this.deps.expenses,
      payments: this.deps.payments,
      inventoryLevels: this.deps.inventoryLevels,
      campaigns: this.deps.campaigns,
    };

    const outcome: EntityOutcome = {
      entityType,
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      issues: [],
      normalized: [],
    };
    const reasons = new Map<string, { count: number; sample?: unknown }>();

    let skip = 0;
    for (;;) {
      const page = await this.deps.rawRecords.list({
        tenantId,
        dataSourceId,
        entityType,
        skip: unprocessedOnly ? 0 : skip,
        take: NORMALIZE_PAGE_SIZE,
        unprocessedOnly,
      });
      if (page.items.length === 0) break;

      for (const record of page.items) {
        outcome.total += 1;
        const normalized = normalizeRow(record.payload as Record<string, unknown>, fields);
        // The source external_id is authoritative when the mapping omits it.
        if (normalized['external_id'] == null && record.externalId) {
          normalized['external_id'] = record.externalId;
        }
        outcome.normalized.push(normalized);

        const extracted = extractCustomData(normalized);
        const customData = this.deps.customData
          ? await this.deps.customData.pickValid(tenantId, entityType, extracted)
          : extracted;

        try {
          const result = await normalizeToCanonical(
            tenantId,
            dataSourceId,
            entityType,
            normalized,
            repositories,
            customData,
          );
          if (result.status === 'skipped') {
            outcome.skipped += 1;
            addReason(reasons, result.reason, result.sample);
            if (unprocessedOnly) await this.deps.rawRecords.markProcessed({ id: record.id });
            continue;
          }
          if (result.status === 'created') outcome.created += 1;
          else outcome.updated += 1;
          await this.deps.rawRecords.markProcessed({ id: record.id });
        } catch (error) {
          outcome.skipped += 1;
          addReason(
            reasons,
            isAppError(error) ? error.code : 'upsert_failed',
            error instanceof Error ? error.message : String(error),
          );
          if (unprocessedOnly) await this.deps.rawRecords.markProcessed({ id: record.id });
        }
      }

      skip += page.items.length;
      if (unprocessedOnly) {
        if (page.items.length < NORMALIZE_PAGE_SIZE) break;
        continue;
      }
      if (skip >= page.total) break;
    }

    outcome.issues = [...reasons.entries()].map(([rule, { count, sample }]) => ({
      rule,
      count,
      ...(sample === undefined ? {} : { sample }),
    }));

    return outcome;
  }

  private async buildConnector(
    tenantId: string,
    ds: { id: string; type: string; configuration: unknown; credentialId: string | null },
    snapshot: unknown = null,
  ) {
    const config = (ds.configuration ?? {}) as Record<string, unknown>;

    if (ds.type === 'csv') {
      return new CsvConnector(
        { filePath: String(config['filePath'] ?? '') },
        this.deps.rawRecords,
      );
    }

    const sql = sqlConnectorFromSource({
      type: ds.type,
      configuration: ds.configuration,
      credentials: await this.decryptCredentials(tenantId, ds.credentialId),
      rawRecords: this.deps.rawRecords,
    });
    if (sql) return sql;

    if (ds.type === 'mcp') {
      const credData = await this.decryptCredentials(tenantId, ds.credentialId);
      return new McpConnector(
        {
          url: String(config['url'] ?? ''),
          authorization:
            typeof credData['authorization'] === 'string' ? credData['authorization'] : undefined,
        },
        this.deps.rawRecords,
      );
    }

    if (ds.type === 'torge') {
      if (!ds.credentialId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Credencial Torge obrigatória.');
      const credentialId = ds.credentialId;
      const decrypted = await this.decryptCredentials(tenantId, credentialId);
      const resolver: BrowserCredentialResolver = {
        resolve: async (connectionId, refs) => {
          if (connectionId !== ds.id || refs.length !== 1 || refs[0] !== credentialId) {
            throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Referência de credencial inválida.');
          }
          return decrypted;
        },
      };
      let torgeConfig;
      try {
        torgeConfig = parseTorgeConnectionConfig(ds.configuration);
      } catch (error) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, error instanceof Error ? error.message : 'Configuração Torge inválida.');
      }
      const executor = await this.buildBrowserExecutor(tenantId, torgeConfig.instanceKey, resolver, snapshot);
      return new TorgeConnector(
        ds.id,
        credentialId,
        torgeConfig,
        executor,
        this.deps.rawRecords,
      );
    }

    throw new AppError(ErrorCode.CONNECTOR_ERROR, `Connector type '${ds.type}' not supported yet`);
  }

  private async decryptCredentials(
    tenantId: string,
    credentialId: string | null,
  ): Promise<Record<string, unknown>> {
    if (!credentialId) return {};
    const cred = await this.deps.credentials.findById({ tenantId, id: credentialId });
    if (!cred) return {};
    return JSON.parse(decrypt(cred.encryptedData)) as Record<string, unknown>;
  }

  /**
   * Minimal tenant-scoped context for BrowserIntegrationService calls made from
   * the worker path, where the original RequestContext is not threaded through.
   */
  private browserCtx(tenantId: string): RequestContext {
    return { requestId: 'sync-worker', tenantId, userId: null, role: null, operatorId: 'system-sync-worker' };
  }

  /**
   * Captures the immutable browser configuration snapshot at SyncJob creation
   * time. Only torge (browser) sources carry a snapshot; it never contains a
   * secret value, only credential references and resolved task IDs.
   */
  private async buildBrowserSnapshot(
    ctx: RequestContext,
    ds: { id: string; type: string; configuration: unknown; credentialId: string | null },
  ): Promise<Record<string, unknown> | null> {
    if (ds.type !== 'torge' || !this.deps.browserIntegration) return null;
    let torgeConfig;
    try {
      torgeConfig = parseTorgeConnectionConfig(ds.configuration);
    } catch {
      return null;
    }
    const environment = process.env['TACTIA_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development';
    try {
      const { snapshot } = await this.deps.browserIntegration.resolveFigranium(ctx, {
        provider: 'torge',
        environment,
        instanceKey: torgeConfig.instanceKey,
        sourceCredentialId: ds.credentialId,
      });
      return snapshot as unknown as Record<string, unknown>;
    } catch (error) {
      logger.warn({
        operation: 'browser_snapshot_skipped',
        tenant_id: ctx.tenantId,
        data_source_id: ds.id,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    }
  }

  /**
   * Builds the Figranium executor for a torge sync. On retries it rehydrates the
   * exact instance/bindings from the SyncJob snapshot; otherwise it resolves
   * DB-first (with env fallback). When no browser integration service is wired,
   * it falls back to the legacy env-only executor.
   */
  private async buildBrowserExecutor(
    tenantId: string,
    instanceKey: string,
    resolver: BrowserCredentialResolver,
    snapshot: unknown,
  ) {
    const integration = this.deps.browserIntegration;
    if (integration) {
      const ctx = this.browserCtx(tenantId);
      const snap = snapshot && typeof snapshot === 'object' ? (snapshot as BrowserSyncSnapshot) : null;
      const resolved = snap && snap.instanceKey
        ? await integration.resolveFromSnapshot(ctx, snap)
        : (await integration.resolveFigranium(ctx, {
            provider: 'torge',
            environment: process.env['TACTIA_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development',
            instanceKey,
          })).resolved;
      return createFigraniumExecutorFromResolved(resolved, resolver);
    }
    return createFigraniumExecutorFromEnv(instanceKey, resolver);
  }
}

function addReason(
  map: Map<string, { count: number; sample?: unknown }>,
  rule: string,
  sample?: unknown,
) {
  const existing = map.get(rule);
  if (existing) existing.count += 1;
  else map.set(rule, { count: 1, ...(sample === undefined ? {} : { sample }) });
}

/**
 * Two mappings may target the same canonical entity. Their field lists are
 * merged (first mapping wins per target field) so the normalizer sees a single
 * configuration per entity type.
 */
function mergeFieldsByTargetEntity(
  mappings: Array<{ targetEntity: string; configuration: MappingConfig }>,
): Map<string, FieldMapping[]> {
  const byEntity = new Map<string, FieldMapping[]>();
  for (const mapping of mappings) {
    const current = byEntity.get(mapping.targetEntity) ?? [];
    const seen = new Set(current.map((field) => field.target));
    for (const field of mapping.configuration?.fields ?? []) {
      if (seen.has(field.target)) continue;
      seen.add(field.target);
      current.push(field);
    }
    byEntity.set(mapping.targetEntity, current);
  }
  return byEntity;
}

function localScheduleParts(now: Date, timeZone: string): { dateKey: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { dateKey: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
