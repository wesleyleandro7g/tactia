import type {
  DataSourceRepository,
  DataSourceStatus,
  MappingRepository,
  CredentialRepository,
  RawRecordRepository,
} from '@tactia/database';
import { computeTrelloKanbanMetrics } from '@tactia/intelligence';
import { AppError, ErrorCode, paginationArgs, type RequestContext } from '@tactia/shared';
import {
  CsvConnector,
  McpConnector,
  TrelloClient,
  TrelloConnector,
  trelloCallbackUrl,
  TorgeConnector,
  WebPortalConnector,
  parseWebPortalConfig,
  parseWebPortalCredentials,
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
  probeTrelloDataSourceSchema,
  trelloConfigurationSchema,
  updateDataSourceSchema,
  updateMappingSchema,
} from '../schemas/data-platform';
import { AuditAction, type AuditLogService } from './audit-log-service';
import { CredentialService } from './credential-service';
import type { BrowserIntegrationService } from './browser-integration-service';
import { listQuerySchema } from '../schemas/business';
import { trelloAuthFromCredential } from './trello-oauth-credential';

export class DataSourceService {
  constructor(
    private readonly dataSources: DataSourceRepository,
    private readonly mappings: MappingRepository,
    private readonly credentials: CredentialRepository,
    private readonly auditLogs: AuditLogService,
    private readonly rawRecords?: RawRecordRepository,
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
    if (input.type === 'trello') trelloConfigurationSchema.parse(input.configuration);
    if (input.type === 'web_portal') this.parseWebPortalConfiguration(input.configuration);
    if (input.credentialId) {
      const credential = await this.credentials.findById({ tenantId: ctx.tenantId!, id: input.credentialId });
      if (!credential) throw new AppError(ErrorCode.NOT_FOUND, 'Credential not found');
    }
    const torgeConfig = input.type === 'torge'
      ? this.parseTorgeConfiguration(input.configuration)
      : null;
    let ds = await this.dataSources.create({
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

    if (input.type === 'trello' && input.credentialId) {
      const configuration = trelloConfigurationSchema.parse(input.configuration);
      const webhooks: Record<string, string> = {};
      try {
        const auth = await trelloAuthFromCredential({
          tenantId: ctx.tenantId!,
          credentialId: input.credentialId,
          credentials: this.credentials,
        });
        const client = new TrelloClient({ auth });
        const callbackURL = trelloCallbackUrl(ds.id, ctx.tenantId!);
        for (const boardId of configuration.boardIds) {
          const webhook = await client.createWebhook({
            callbackURL,
            idModel: boardId,
            description: `Tactia · ${ds.name}`,
          });
          if (typeof webhook['id'] === 'string') webhooks[boardId] = webhook['id'];
        }
        const updated = await this.dataSources.update({
          tenantId: ctx.tenantId!,
          id: ds.id,
          data: { configuration: { ...configuration, webhooks, webhookStatus: 'active' } },
        });
        if (updated) ds = updated;
      } catch {
        const updated = await this.dataSources.update({
          tenantId: ctx.tenantId!,
          id: ds.id,
          data: { configuration: { ...configuration, webhooks, webhookStatus: 'pending' } },
        });
        if (updated) ds = updated;
      }
    }
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
    if (current.type === 'trello' && input.configuration != null) {
      trelloConfigurationSchema.parse(input.configuration);
    }
    if (current.type === 'web_portal' && input.configuration != null) {
      this.parseWebPortalConfiguration(input.configuration);
    }
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
    const current = await this.get(ctx, id);
    if (current.type === 'trello' && current.credentialId) {
      try {
        const config = (current.configuration ?? {}) as Record<string, unknown>;
        const webhooks = config['webhooks'] && typeof config['webhooks'] === 'object'
          ? Object.values(config['webhooks'] as Record<string, unknown>).filter((value): value is string => typeof value === 'string')
          : [];
        const auth = await trelloAuthFromCredential({
          tenantId: ctx.tenantId!,
          credentialId: current.credentialId,
          credentials: this.credentials,
        });
        const client = new TrelloClient({ auth });
        await Promise.allSettled(webhooks.map((webhookId) => client.deleteWebhook(webhookId)));
      } catch {
        // A 410 callback will ask Trello to remove any webhook left behind.
      }
    }
    const ds = await this.dataSources.softDelete({ tenantId: ctx.tenantId!, id });
    if (!ds) throw new AppError(ErrorCode.NOT_FOUND, 'DataSource not found');
    if (current.type === 'trello' && current.credentialId) {
      await this.credentials.delete({ tenantId: ctx.tenantId!, id: current.credentialId }).catch(() => null);
    }
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
  ): Promise<ConnectionTestResult & { resources?: DiscoveryResource[]; boards?: Array<Record<string, unknown>> }> {
    assertCanManageConnections(ctx);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>)['type'] === 'trello') {
      const input = probeTrelloDataSourceSchema.parse(raw);
      const auth = input.credentialId
        ? await trelloAuthFromCredential({
            tenantId: ctx.tenantId!,
            credentialId: input.credentialId,
            credentials: this.credentials,
          })
        : {
            kind: 'token' as const,
            apiKey: input.credentials!.apiKey,
            token: input.credentials!.token,
          };
      const connector = new TrelloConnector({
        boardIds: [],
        auth,
      });
      const test = await connector.testConnection();
      if (!test.success) return test;
      const boards = await connector.listBoards();
      return { ...test, boards };
    }
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

  async trelloMetrics(ctx: RequestContext, id: string) {
    const source = await this.get(ctx, id);
    if (source.type !== 'trello') throw new AppError(ErrorCode.VALIDATION_ERROR, 'Trello source required');
    if (!this.rawRecords) throw new AppError(ErrorCode.INTERNAL_ERROR, 'Raw record repository unavailable');
    const load = async (entityType: string) => {
      const rows: RawRow[] = [];
      let skip = 0;
      for (;;) {
        const page = await this.rawRecords!.list({ tenantId: ctx.tenantId!, dataSourceId: id, entityType, skip, take: 2000 });
        rows.push(...page.items.map((item) => item.payload as RawRow));
        skip += page.items.length;
        if (skip >= page.total || page.items.length === 0) break;
      }
      return rows;
    };
    const [cards, actions] = await Promise.all([load('trello:cards'), load('trello:actions')]);
    const config = (source.configuration ?? {}) as Record<string, unknown>;
    const kanban = config['kanban'] && typeof config['kanban'] === 'object'
      ? config['kanban'] as Record<string, unknown>
      : {};
    const strings = (key: string) => Array.isArray(kanban[key])
      ? (kanban[key] as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    return computeTrelloKanbanMetrics(cards, actions, {
      inProgressListIds: strings('inProgressListIds'),
      doneListIds: strings('doneListIds'),
      blockedListIds: strings('blockedListIds'),
      windowDays: typeof kanban['windowDays'] === 'number' ? kanban['windowDays'] : 30,
    });
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

    if (ds.type === 'trello') {
      const parsed = trelloConfigurationSchema.parse(config);
      const auth = ds.credentialId
        ? await trelloAuthFromCredential({
            tenantId: ctx.tenantId!,
            credentialId: ds.credentialId,
            credentials: this.credentials,
          })
        : { kind: 'token' as const, apiKey: '', token: '' };
      return new TrelloConnector({
        boardIds: parsed.boardIds,
        historyDays: parsed.historyDays,
        auth,
      });
    }

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

    if (ds.type === 'web_portal') {
      let recipe;
      try {
        recipe = parseWebPortalConfig(ds.configuration);
      } catch (error) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          error instanceof Error ? error.message : 'Configuração do portal web inválida.',
        );
      }
      let portalCreds: Record<string, unknown> = {};
      if (ds.credentialId) {
        portalCreds = await new CredentialService(this.credentials).getDecryptedData(ctx, ds.credentialId);
      }
      return new WebPortalConnector({
        tenantId: ctx.tenantId!,
        dataSourceId: ds.id,
        recipe,
        credentials: parseWebPortalCredentials(portalCreds),
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

  private parseWebPortalConfiguration(value: unknown) {
    try {
      return parseWebPortalConfig(value);
    } catch (error) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        error instanceof Error ? error.message : 'Configuração do portal web inválida.',
      );
    }
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
