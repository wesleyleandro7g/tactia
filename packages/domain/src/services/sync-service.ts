import type {
  DataSourceRepository,
  SyncJobRepository,
  RawRecordRepository,
  ImportRepository,
  DataQualityReportRepository,
  MappingRepository,
  CredentialRepository,
} from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import {
  CsvConnector,
  PostgresConnector,
  runDataQualityChecks,
  type MappingConfig,
} from '@tactia/connectors';
import { assertTenantContext } from '../authz';
import { AuditAction, type AuditLogService } from './audit-log-service';
import { decrypt } from './credential-service';

export class SyncService {
  constructor(
    private readonly dataSources: DataSourceRepository,
    private readonly syncJobs: SyncJobRepository,
    private readonly rawRecords: RawRecordRepository,
    private readonly imports: ImportRepository,
    private readonly qualityReports: DataQualityReportRepository,
    private readonly mappings: MappingRepository,
    private readonly credentials: CredentialRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async startSync(ctx: RequestContext, dataSourceId: string) {
    assertTenantContext(ctx);
    const ds = await this.dataSources.findById({ tenantId: ctx.tenantId!, id: dataSourceId });
    if (!ds) throw new AppError(ErrorCode.NOT_FOUND, 'DataSource not found');

    const job = await this.syncJobs.create({
      tenantId: ctx.tenantId!,
      dataSourceId,
      status: 'pending',
    });

    await this.auditLogs.record(ctx, {
      action: AuditAction.SYNC_STARTED,
      entityType: 'sync_job',
      entityId: job.id,
      metadata: { dataSourceId },
    });

    // Execute inline if SYNC_INLINE=true or in test environment, or always by default for V0.1
    // pg-boss integration is configured at app level; domain service always runs inline
    await this.executeSync(ctx.tenantId!, job.id);

    return job;
  }

  async getSyncJob(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const job = await this.syncJobs.findById({ tenantId: ctx.tenantId!, id });
    if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'SyncJob not found');
    return job;
  }

  async listSyncJobs(
    ctx: RequestContext,
    query: Record<string, string | undefined>,
  ) {
    assertTenantContext(ctx);
    const page = parseInt(query['page'] ?? '1', 10);
    const pageSize = parseInt(query['pageSize'] ?? '20', 10);
    const skip = (page - 1) * pageSize;
    const result = await this.syncJobs.list({
      tenantId: ctx.tenantId!,
      dataSourceId: query['dataSourceId'],
      skip,
      take: pageSize,
    });
    return { ...result, pagination: { page, pageSize } };
  }

  async cancelSyncJob(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const job = await this.syncJobs.findById({ tenantId: ctx.tenantId!, id });
    if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'SyncJob not found');
    if (job.status !== 'pending') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Only pending sync jobs can be cancelled');
    }
    return this.syncJobs.updateStatus({ id, status: 'cancelled' });
  }

  async executeSync(tenantId: string, syncJobId: string): Promise<void> {
    await this.syncJobs.updateStatus({
      id: syncJobId,
      status: 'running',
      startedAt: new Date(),
    });

    try {
      const job = await this.syncJobs.findById({ tenantId, id: syncJobId });
      if (!job) throw new Error('SyncJob not found');

      const ds = await this.dataSources.findById({ tenantId, id: job.dataSourceId });
      if (!ds) throw new Error('DataSource not found');

      const activeMappings = await this.mappings.findByDataSource({
        tenantId,
        dataSourceId: ds.id,
        activeOnly: true,
      });

      const syncContextMappings = activeMappings.map((m) => ({
        sourceEntity: m.sourceEntity,
        targetEntity: m.targetEntity,
        configuration: m.configuration as unknown as MappingConfig,
      }));

      // Build connector
      const connector = await this._buildConnector(tenantId, ds);

      // Execute sync — connector writes RawRecords
      const result = await connector.sync({
        tenantId,
        dataSourceId: ds.id,
        syncJobId,
        mappings: syncContextMappings,
        onProgress: async (counters) => {
          await this.syncJobs.updateCounters({
            id: syncJobId,
            recordsRead: counters.read,
            recordsCreated: counters.created,
            recordsUpdated: counters.updated,
            recordsFailed: counters.failed,
          });
        },
      });

      // Data quality checks and Import records per entity type
      const entityTypes = [...new Set(activeMappings.map((m) => m.targetEntity))];
      for (const entityType of entityTypes) {
        // Fetch raw records for this entity to run quality checks
        const rawResult = await this.rawRecords.list({
          tenantId,
          dataSourceId: ds.id,
          entityType,
          skip: 0,
          take: 10_000,
        });
        const records = rawResult.items.map((r) => r.payload as Record<string, unknown>);
        const qr = runDataQualityChecks(entityType, records);

        await this.qualityReports.create({
          tenantId,
          dataSourceId: ds.id,
          syncJobId,
          entityType,
          totalRecords: qr.totalRecords,
          validRecords: qr.validRecords,
          invalidRecords: qr.invalidRecords,
          warnings: qr.warnings,
          errors: qr.errors,
        });

        await this.imports.create({
          tenantId,
          dataSourceId: ds.id,
          syncJobId,
          entityType,
          totalRecords: qr.totalRecords,
        });
      }

      await this.syncJobs.updateStatus({
        id: syncJobId,
        status: 'completed',
        finishedAt: new Date(),
      });
      await this.syncJobs.updateCounters({
        id: syncJobId,
        recordsRead: result.recordsRead,
        recordsCreated: result.recordsCreated,
        recordsUpdated: result.recordsUpdated,
        recordsFailed: result.recordsFailed,
      });

      // Update lastSyncAt on dataSource
      await this.dataSources.updateLastSyncAt({ id: ds.id, lastSyncAt: new Date() });

      // Audit
      await this.auditLogs.record(
        { tenantId, userId: null },
        {
          action: AuditAction.SYNC_COMPLETED,
          entityType: 'sync_job',
          entityId: syncJobId,
          metadata: result,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.syncJobs.updateStatus({
        id: syncJobId,
        status: 'failed',
        finishedAt: new Date(),
        error: message,
      });
    }
  }

  private async _buildConnector(
    tenantId: string,
    ds: { type: string; configuration: unknown; credentialId: string | null },
  ) {
    const config = (ds.configuration ?? {}) as Record<string, unknown>;

    if (ds.type === 'csv') {
      return new CsvConnector({ filePath: String(config['filePath'] ?? '') }, this.rawRecords);
    }

    if (ds.type === 'postgres') {
      let credData: Record<string, unknown> = {};
      if (ds.credentialId) {
        const cred = await this.credentials.findById({ tenantId, id: ds.credentialId });
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
        this.rawRecords,
      );
    }

    throw new AppError(ErrorCode.CONNECTOR_ERROR, `Connector type '${ds.type}' not supported yet`);
  }
}
