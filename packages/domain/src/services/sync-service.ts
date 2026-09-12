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
  LeadRepository,
  MappingRepository,
  PaymentRepository,
  ProductRepository,
  RawRecordRepository,
  SaleRepository,
  SellerRepository,
  SyncJobRepository,
} from '@tactia/database';
import { AppError, ErrorCode, isAppError, logger, type RequestContext } from '@tactia/shared';
import {
  canonicalEntityRank,
  CsvConnector,
  McpConnector,
  normalizeRow,
  normalizeToCanonical,
  PostgresConnector,
  runDataQualityChecks,
  type FieldMapping,
  type MappingConfig,
  type QualityIssue,
} from '@tactia/connectors';
import { assertTenantContext } from '../authz';
import { AuditAction, type AuditLogService } from './audit-log-service';
import { decrypt } from './credential-service';

export type SyncServiceDeps = {
  dataSources: DataSourceRepository;
  syncJobs: SyncJobRepository;
  rawRecords: RawRecordRepository;
  imports: ImportRepository;
  qualityReports: DataQualityReportRepository;
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
  }) => Promise<void>;
};

/** Raw records are normalized in pages to keep memory flat on large imports. */
const NORMALIZE_PAGE_SIZE = 500;

type EntityOutcome = {
  entityType: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  issues: QualityIssue[];
  normalized: Record<string, unknown>[];
};

export class SyncService {
  constructor(private readonly deps: SyncServiceDeps) {}

  async startSync(ctx: RequestContext, dataSourceId: string) {
    assertTenantContext(ctx);
    const tenantId = ctx.tenantId!;
    const ds = await this.deps.dataSources.findById({ tenantId, id: dataSourceId });
    if (!ds) throw new AppError(ErrorCode.NOT_FOUND, 'DataSource not found');

    const job = await this.deps.syncJobs.create({
      tenantId,
      dataSourceId,
      status: 'pending',
    });

    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.SYNC_STARTED,
      entityType: 'sync_job',
      entityId: job.id,
      metadata: { dataSourceId },
    });

    const meta = { requestId: ctx.requestId, userId: ctx.userId ?? null };
    if (this.deps.enqueueSync) {
      await this.deps.enqueueSync({ tenantId, syncJobId: job.id, ...meta });
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
    assertTenantContext(ctx);
    const job = await this.deps.syncJobs.findById({ tenantId: ctx.tenantId!, id });
    if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'SyncJob not found');
    if (job.status !== 'pending') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Only pending sync jobs can be cancelled');
    }
    return this.deps.syncJobs.updateStatus({ id, status: 'cancelled' });
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
    meta: { requestId?: string; userId?: string | null } = {},
  ): Promise<void> {
    const started = Date.now();
    const requestId = meta.requestId;
    let dataSourceId: string | null = null;

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

      const connector = await this.buildConnector(tenantId, ds);

      // 1. Source → RawRecord (originals preserved, spec §3.3)
      const raw = await connector.sync({
        tenantId,
        dataSourceId: ds.id,
        syncJobId,
        mappings: syncContextMappings,
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

      // 2. RawRecord → normalize → canonical upsert, in dependency order
      const fieldsByEntity = mergeFieldsByTargetEntity(syncContextMappings);
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

      await this.deps.syncJobs.updateCounters({
        id: syncJobId,
        recordsRead: raw.recordsRead,
        recordsCreated: totals.created,
        recordsUpdated: totals.updated,
        recordsFailed: raw.recordsFailed + totals.skipped,
      });
      await this.deps.syncJobs.updateStatus({
        id: syncJobId,
        status: 'completed',
        finishedAt: new Date(),
      });
      await this.deps.dataSources.updateLastSyncAt({ id: ds.id, lastSyncAt: new Date() });

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
          action: AuditAction.SYNC_COMPLETED,
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
        status: 'completed',
      });

      if (this.deps.onSyncCompleted) {
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
  }): Promise<EntityOutcome> {
    const { tenantId, dataSourceId, entityType, fields } = input;
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
        skip,
        take: NORMALIZE_PAGE_SIZE,
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

        try {
          const result = await normalizeToCanonical(
            tenantId,
            dataSourceId,
            entityType,
            normalized,
            repositories,
          );
          if (result.status === 'skipped') {
            outcome.skipped += 1;
            addReason(reasons, result.reason, result.sample);
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
        }
      }

      skip += page.items.length;
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
    ds: { type: string; configuration: unknown; credentialId: string | null },
  ) {
    const config = (ds.configuration ?? {}) as Record<string, unknown>;

    if (ds.type === 'csv') {
      return new CsvConnector(
        { filePath: String(config['filePath'] ?? '') },
        this.deps.rawRecords,
      );
    }

    if (ds.type === 'postgres') {
      let credData: Record<string, unknown> = {};
      if (ds.credentialId) {
        const cred = await this.deps.credentials.findById({ tenantId, id: ds.credentialId });
        if (cred) {
          credData = JSON.parse(decrypt(cred.encryptedData)) as Record<string, unknown>;
        }
      }
      return new PostgresConnector(
        {
          host: String(config['host'] ?? 'localhost'),
          port: Number(config['port'] ?? 5432),
          database: String(config['database'] ?? ''),
          schema: config['schema'] ? String(config['schema']) : undefined,
          ssl: config['ssl'] === true,
          username: String(credData['username'] ?? ''),
          password: String(credData['password'] ?? ''),
        },
        this.deps.rawRecords,
      );
    }

    if (ds.type === 'mcp') {
      let credData: Record<string, unknown> = {};
      if (ds.credentialId) {
        const cred = await this.deps.credentials.findById({ tenantId, id: ds.credentialId });
        if (cred) {
          credData = JSON.parse(decrypt(cred.encryptedData)) as Record<string, unknown>;
        }
      }
      return new McpConnector(
        {
          url: String(config['url'] ?? ''),
          authorization:
            typeof credData['authorization'] === 'string' ? credData['authorization'] : undefined,
        },
        this.deps.rawRecords,
      );
    }

    throw new AppError(ErrorCode.CONNECTOR_ERROR, `Connector type '${ds.type}' not supported yet`);
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
