import type {
  DataSourceRepository,
  DataSourceStatus,
  MappingRepository,
  CredentialRepository,
} from '@tactia/database';
import { AppError, ErrorCode, paginationArgs, type RequestContext } from '@tactia/shared';
import {
  CsvConnector,
  McpConnector,
  sqlConnectorFromSource,
  type ConnectionTestResult,
  type DiscoveryResult,
  type DiscoveryResource,
  type RawRow,
} from '@tactia/connectors';
import { assertCanManageConnections, assertTenantScope } from '../authz';
import {
  createDataSourceSchema,
  createMappingSchema,
  probeDataSourceSchema,
  updateDataSourceSchema,
  updateMappingSchema,
} from '../schemas/data-platform';
import { AuditAction, type AuditLogService } from './audit-log-service';
import { CredentialService } from './credential-service';
import { listQuerySchema } from '../schemas/business';

export class DataSourceService {
  constructor(
    private readonly dataSources: DataSourceRepository,
    private readonly mappings: MappingRepository,
    private readonly credentials: CredentialRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantScope(ctx);
    const parsed = listQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.dataSources.list({
      tenantId: ctx.tenantId!,
      skip,
      take,
      status: parsed.status as DataSourceStatus | undefined,
      search: parsed.search,
    });
    return { ...result, pagination: { page: parsed.page, pageSize: parsed.pageSize } };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantScope(ctx);
    const ds = await this.dataSources.findById({ tenantId: ctx.tenantId!, id });
    if (!ds) throw new AppError(ErrorCode.NOT_FOUND, 'DataSource not found');
    return ds;
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertCanManageConnections(ctx);
    const input = createDataSourceSchema.parse(raw);
    const ds = await this.dataSources.create({
      tenantId: ctx.tenantId!,
      ...input,
      configuration: input.configuration ?? null,
      credentialId: input.credentialId ?? null,
    });
    await this.auditLogs.record(ctx, {
      action: AuditAction.DATA_SOURCE_CREATED,
      entityType: 'data_source',
      entityId: ds.id,
      metadata: { name: ds.name, type: ds.type },
    });
    return ds;
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertCanManageConnections(ctx);
    const input = updateDataSourceSchema.parse(raw);
    const ds = await this.dataSources.update({
      tenantId: ctx.tenantId!,
      id,
      data: {
        name: input.name,
        status: input.status,
        ...(input.configuration !== undefined ? { configuration: input.configuration } : {}),
        ...(input.credentialId !== undefined ? { credentialId: input.credentialId } : {}),
      },
    });
    if (!ds) throw new AppError(ErrorCode.NOT_FOUND, 'DataSource not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.DATA_SOURCE_UPDATED,
      entityType: 'data_source',
      entityId: id,
      metadata: input,
    });
    return ds;
  }

  async remove(ctx: RequestContext, id: string) {
    assertCanManageConnections(ctx);
    const ds = await this.dataSources.softDelete({ tenantId: ctx.tenantId!, id });
    if (!ds) throw new AppError(ErrorCode.NOT_FOUND, 'DataSource not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.DATA_SOURCE_DELETED,
      entityType: 'data_source',
      entityId: id,
    });
    return ds;
  }

  async testConnection(ctx: RequestContext, id: string): Promise<ConnectionTestResult> {
    const ds = await this.get(ctx, id);
    const connector = await this._buildConnector(ctx, ds);
    return connector.testConnection();
  }

  async discover(ctx: RequestContext, id: string): Promise<DiscoveryResult> {
    const ds = await this.get(ctx, id);
    const connector = await this._buildConnector(ctx, ds);
    return connector.discover();
  }

  async preview(ctx: RequestContext, id: string, resource: string, limit = 20): Promise<RawRow[]> {
    const ds = await this.get(ctx, id);
    const connector = await this._buildConnector(ctx, ds);
    return connector.fetch(resource, { limit });
  }

  async probeConnection(
    ctx: RequestContext,
    raw: unknown,
  ): Promise<ConnectionTestResult & { resources?: DiscoveryResource[] }> {
    assertCanManageConnections(ctx);
    const input = probeDataSourceSchema.parse(raw);
    const connector = sqlConnectorFromSource({
      type: 'database',
      configuration: { dialect: input.dialect, ...input.configuration },
      credentials: input.credentials,
    });
    if (!connector) {
      throw new AppError(ErrorCode.CONNECTOR_ERROR, 'Unsupported SQL dialect');
    }
    const test = await connector.testConnection();
    if (!test.success) {
      return { success: false, message: test.message };
    }
    const discovery = await connector.discover();
    return {
      success: true,
      message: 'Conexão bem-sucedida',
      resources: discovery.resources,
    };
  }

  // Mapping CRUD

  async listMappings(ctx: RequestContext, dataSourceId: string, query: Record<string, string | undefined>) {
    const ds = await this.get(ctx, dataSourceId);
    const parsed = listQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    return this.mappings.list({ tenantId: ctx.tenantId!, dataSourceId: ds.id, skip, take });
  }

  async createMapping(ctx: RequestContext, dataSourceId: string, raw: unknown) {
    assertCanManageConnections(ctx);
    await this.get(ctx, dataSourceId);
    const input = createMappingSchema.parse(raw);
    return this.mappings.create({
      tenantId: ctx.tenantId!,
      dataSourceId,
      sourceEntity: input.sourceEntity,
      targetEntity: input.targetEntity,
      configuration: input.configuration as Record<string, unknown>,
    });
  }

  async getMapping(ctx: RequestContext, dataSourceId: string, mappingId: string) {
    await this.get(ctx, dataSourceId);
    const mapping = await this.mappings.findById({ tenantId: ctx.tenantId!, id: mappingId });
    if (!mapping) throw new AppError(ErrorCode.NOT_FOUND, 'Mapping not found');
    return mapping;
  }

  async updateMapping(ctx: RequestContext, dataSourceId: string, mappingId: string, raw: unknown) {
    assertCanManageConnections(ctx);
    await this.get(ctx, dataSourceId);
    const input = updateMappingSchema.parse(raw);
    const mapping = await this.mappings.update({
      tenantId: ctx.tenantId!,
      id: mappingId,
      data: {
        sourceEntity: input.sourceEntity,
        targetEntity: input.targetEntity,
        configuration: input.configuration as Record<string, unknown> | undefined,
        active: input.configuration !== undefined ? true : undefined,
      },
    });
    if (!mapping) throw new AppError(ErrorCode.NOT_FOUND, 'Mapping not found');
    return mapping;
  }

  async deleteMapping(ctx: RequestContext, dataSourceId: string, mappingId: string) {
    assertCanManageConnections(ctx);
    await this.get(ctx, dataSourceId);
    const mapping = await this.mappings.delete({ tenantId: ctx.tenantId!, id: mappingId });
    if (!mapping) throw new AppError(ErrorCode.NOT_FOUND, 'Mapping not found');
    return mapping;
  }

  private async _buildConnector(ctx: RequestContext, ds: { type: string; configuration: unknown; credentialId: string | null }) {
    const config = (ds.configuration ?? {}) as Record<string, unknown>;

    if (ds.type === 'csv') {
      return new CsvConnector({ filePath: String(config['filePath'] ?? '') });
    }

    const sql = sqlConnectorFromSource({
      type: ds.type,
      configuration: ds.configuration,
      credentials:
        ds.type === 'database' || ds.type === 'postgres' || ds.type === 'mysql'
          ? ds.credentialId
            ? await new CredentialService(this.credentials).getDecryptedData(ctx, ds.credentialId)
            : {}
          : {},
    });
    if (sql) return sql;

    if (ds.type === 'mcp') {
      let credData: Record<string, unknown> = {};
      if (ds.credentialId) {
        const credService = new CredentialService(this.credentials);
        credData = await credService.getDecryptedData(ctx, ds.credentialId);
      }
      return new McpConnector({
        url: String(config['url'] ?? ''),
        authorization:
          typeof credData['authorization'] === 'string' ? credData['authorization'] : undefined,
      });
    }

    throw new AppError(ErrorCode.CONNECTOR_ERROR, `Connector type '${ds.type}' not supported yet`);
  }
}
