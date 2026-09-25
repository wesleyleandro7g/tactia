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
  TorgeConnector,
  assertTorgeModulesEnableable,
  createFigraniumExecutorFromEnv,
  createFigraniumExecutorFromResolved,
  figraniumConfigFromEnv,
  parseTorgeConnectionConfig,
  sqlConnectorFromSource,
  type BrowserCredentialResolver,
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
import type { BrowserIntegrationService } from './browser-integration-service';
import { listQuerySchema } from '../schemas/business';

export class DataSourceService {
  constructor(
    private readonly dataSources: DataSourceRepository,
    private readonly mappings: MappingRepository,
    private readonly credentials: CredentialRepository,
    private readonly auditLogs: AuditLogService,
    private readonly browserIntegration?: BrowserIntegrationService,
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
    if (input.credentialId) {
      const credential = await this.credentials.findById({ tenantId: ctx.tenantId!, id: input.credentialId });
      if (!credential) throw new AppError(ErrorCode.NOT_FOUND, 'Credential not found');
    }
    const torgeConfig = input.type === 'torge'
      ? this.parseTorgeConfiguration(input.configuration)
      : null;
    const ds = await this.dataSources.create({
      tenantId: ctx.tenantId!,
      ...input,
      status: input.type === 'torge' ? 'draft' : undefined,
      configuration: input.configuration ?? null,
      credentialId: input.credentialId ?? null,
    });
    if (torgeConfig?.enabledModules.includes('products')) {
      await this.mappings.create({
        tenantId: ctx.tenantId!,
        dataSourceId: ds.id,
        sourceEntity: 'products',
        targetEntity: 'product',
        configuration: {
          fields: [
            { source: 'external_id', target: 'external_id' },
            { source: 'name', target: 'name' },
            { source: 'sku', target: 'sku' },
            { source: 'price', target: 'price', transform: 'currency' },
            { source: 'cost', target: 'cost', transform: 'currency' },
            { source: 'status', target: 'status' },
            { source: 'source_barcode', target: 'custom:barcode' },
            { source: 'source_quantity', target: 'custom:source_quantity' },
            { source: 'source_unit', target: 'custom:unit' },
            { source: 'source_group', target: 'custom:group' },
          ],
        },
      });
    }
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
    if (input.credentialId) {
      const credential = await this.credentials.findById({ tenantId: ctx.tenantId!, id: input.credentialId });
      if (!credential) throw new AppError(ErrorCode.NOT_FOUND, 'Credential not found');
    }
    const current = await this.get(ctx, id);
    if (current.type === 'torge') {
      const configuration = input.configuration === undefined ? current.configuration : input.configuration;
      const parsed = this.parseTorgeConfiguration(configuration);
      if (input.status === 'active') {
        const credentialId = input.credentialId === undefined ? current.credentialId : input.credentialId;
        if (!credentialId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Credencial Torge obrigatória.');
        try {
          const executorConfig = await this.resolveExecutorConfig(ctx, parsed.instanceKey);
          if (executorConfig.dedicatedConnectionId !== id) {
            throw new Error('A instância Figranium não está dedicada a esta conexão.');
          }
          const modules = assertTorgeModulesEnableable(parsed.enabledModules);
          const bindings = new Set(
            executorConfig.workflows.map((binding) => `${binding.workflowKey}@${binding.workflowVersion}`),
          );
          for (const module of modules) {
            if (!module.workflowKey || !module.workflowVersion || !bindings.has(`${module.workflowKey}@${module.workflowVersion}`)) {
              throw new Error(`Fluxo do módulo ${module.id} não está publicado nesta instância.`);
            }
          }
        } catch (error) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, error instanceof Error ? error.message : 'Instância Figranium inválida.');
        }
      }
    }
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

  private async _buildConnector(ctx: RequestContext, ds: { id: string; type: string; configuration: unknown; credentialId: string | null }) {
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

    if (ds.type === 'torge') {
      if (!ds.credentialId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Credencial Torge obrigatória.');
      const decrypted = await new CredentialService(this.credentials).getDecryptedData(ctx, ds.credentialId);
      const credentialId = ds.credentialId;
      const resolver: BrowserCredentialResolver = {
        resolve: async (connectionId, refs) => {
          if (connectionId !== ds.id || refs.length !== 1 || refs[0] !== credentialId) {
            throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Referência de credencial inválida.');
          }
          return decrypted;
        },
      };
      const torgeConfig = this.parseTorgeConfiguration(ds.configuration);
      return new TorgeConnector(
        ds.id,
        credentialId,
        torgeConfig,
        await this.buildFigraniumExecutor(ctx, torgeConfig.instanceKey, resolver),
      );
    }

    throw new AppError(ErrorCode.CONNECTOR_ERROR, `Connector type '${ds.type}' not supported yet`);
  }

  /**
   * Resolve the Figranium executor config DB-first for this tenant, falling back
   * to FIGRANIUM_INSTANCES_JSON when no browser integration service is wired.
   * Returns only non-secret fields needed for enablement validation.
   */
  private async resolveExecutorConfig(
    ctx: RequestContext,
    instanceKey: string,
  ): Promise<{ dedicatedConnectionId: string; workflows: Array<{ workflowKey: string; workflowVersion: string }> }> {
    if (this.browserIntegration) {
      const environment = process.env['TACTIA_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development';
      const { resolved } = await this.browserIntegration.resolveFigranium(ctx, {
        provider: 'torge',
        environment,
        instanceKey,
      });
      return { dedicatedConnectionId: resolved.dedicatedConnectionId, workflows: resolved.workflows };
    }
    const config = figraniumConfigFromEnv(instanceKey);
    return { dedicatedConnectionId: config.dedicatedConnectionId, workflows: config.workflows };
  }

  private async buildFigraniumExecutor(
    ctx: RequestContext,
    instanceKey: string,
    resolver: BrowserCredentialResolver,
  ) {
    if (this.browserIntegration) {
      const environment = process.env['TACTIA_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development';
      const { resolved } = await this.browserIntegration.resolveFigranium(ctx, {
        provider: 'torge',
        environment,
        instanceKey,
      });
      return createFigraniumExecutorFromResolved(resolved, resolver);
    }
    return createFigraniumExecutorFromEnv(instanceKey, resolver);
  }

  private parseTorgeConfiguration(value: unknown) {
    try {
      const parsed = parseTorgeConnectionConfig(value);
      if ((value as Record<string, unknown> | null)?.['isolationMode'] !== 'dedicated_instance') {
        throw new Error('Torge exige instância dedicada.');
      }
      return parsed;
    } catch (error) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, error instanceof Error ? error.message : 'Configuração Torge inválida.');
    }
  }
}
