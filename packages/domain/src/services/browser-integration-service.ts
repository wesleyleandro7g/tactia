import { createHash } from 'node:crypto';
import type {
  BrowserExecutorInstanceRepository,
  BrowserWorkflowBindingRepository,
  BrowserWorkflowRepository,
  CredentialRepository,
  DataSourceRepository,
} from '@tactia/database';
import {
  FigraniumWorkflowPublisher,
  figraniumConfigFromEnv,
  TORGE_MODULES,
  validateFigraniumBaseUrl,
  validateFigraniumWorkflowDefinition,
  type FigraniumInstancesEnvironment,
  type FigraniumWorkflowBinding,
  type ResolvedFigraniumInstance,
  type VersionedWorkflow,
} from '@tactia/connectors';
import { AppError, ErrorCode, logger, type RequestContext } from '@tactia/shared';
import { assertCanManageConnections, assertTenantScope } from '../authz';
import {
  createBrowserExecutorInstanceSchema,
  importBrowserWorkflowSchema,
  publishBrowserWorkflowSchema,
  setActiveRevisionSchema,
  testBrowserExecutorHealthSchema,
  updateBrowserExecutorInstanceSchema,
} from '../schemas/browser-integration';
import { CredentialService } from './credential-service';
import { AuditAction, type AuditLogService } from './audit-log-service';

/**
 * The immutable snapshot recorded on a SyncJob at creation time. It pins the
 * executor instance, credential references and the resolved remote task IDs so
 * retries reuse the exact same configuration. It never carries a secret value.
 */
export type BrowserSyncSnapshot = {
  engine: string;
  provider: string;
  instanceKey: string;
  environment: string;
  baseUrl: string;
  allowInsecureHttp: boolean;
  dedicatedConnectionId: string;
  /** Reference to the executor API-key credential, never its value. */
  apiKeyCredentialId: string;
  /** Reference to the source login credential, never its value. */
  sourceCredentialId: string | null;
  source: 'database' | 'env';
  workflows: Array<{ workflowKey: string; workflowVersion: string; taskId: string }>;
};

export type BrowserHealthResult = { healthy: boolean; safeMessage: string };

export type BrowserIntegrationDeps = {
  instances: BrowserExecutorInstanceRepository;
  workflows: BrowserWorkflowRepository;
  bindings: BrowserWorkflowBindingRepository;
  credentials: CredentialRepository;
  dataSources?: DataSourceRepository;
  auditLogs?: AuditLogService;
  /** Injected for tests; defaults to a real Figranium publisher. */
  publisherFactory?: (config: { baseUrl: string; apiKey: string }) => {
    publish: (workflow: VersionedWorkflow, marker: string) => Promise<{ taskId: string; operation: 'created' | 'updated' }>;
  };
  /**
   * Injected for tests; defaults to a real health probe that hits `/api/health`
   * and `/api/tasks/list` with the executor API key. Never returns the key.
   */
  healthProbe?: (config: { baseUrl: string; apiKey: string; allowInsecureHttp?: boolean }) => Promise<BrowserHealthResult>;
  env?: FigraniumInstancesEnvironment;
};

export function currentBrowserEnvironment(
  env: Pick<NodeJS.ProcessEnv, 'TACTIA_ENVIRONMENT' | 'NODE_ENV'> = process.env,
): string {
  return env.TACTIA_ENVIRONMENT?.trim() || env.NODE_ENV?.trim() || 'development';
}

function checksumOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const MAX_WORKFLOW_DEFINITION_BYTES = 1024 * 1024;
const FORBIDDEN_TORGE_ACTIONS = new Set([
  'http_request',
  'upload',
  'finalize_uploads',
  'start',
  'solve_captcha',
]);

function validateImportedWorkflow(provider: string, workflow: VersionedWorkflow): void {
  if (Buffer.byteLength(JSON.stringify(workflow), 'utf8') > MAX_WORKFLOW_DEFINITION_BYTES) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Definição de workflow excede 1 MiB.');
  }
  try {
    validateFigraniumWorkflowDefinition(workflow, { requirePublishable: false });
  } catch (error) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      error instanceof Error ? error.message : 'Definição de workflow inválida.',
    );
  }
  if (provider !== 'torge') return;

  const module = TORGE_MODULES.find((item) => item.workflowKey === workflow.workflowKey);
  if (!module || module.status !== 'implemented' || !module.workflowVersion) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Workflow não corresponde a um módulo Torge implementado.');
  }
  if (workflow.workflowVersion !== module.workflowVersion) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `A versão lógica esperada para ${workflow.workflowKey} é ${module.workflowVersion}; substituições usam revisão interna.`,
    );
  }
  const url = workflow.task['url'];
  let target: URL;
  try {
    target = new URL(String(url ?? ''));
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Workflow Torge sem URL válida.');
  }
  if (target.protocol !== 'https:' || target.hostname !== 'app.torge.com.br') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Workflow Torge deve navegar somente em https://app.torge.com.br/.');
  }
  const schedule = workflow.task['schedule'];
  if (schedule && typeof schedule === 'object' && !Array.isArray(schedule) && (schedule as Record<string, unknown>)['enabled'] === true) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Desabilite o agendamento interno do workflow.');
  }
  const translation = workflow.task['translation'];
  if (translation && typeof translation === 'object' && !Array.isArray(translation) && (translation as Record<string, unknown>)['enabled'] === true) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Tradução externa não é permitida no workflow Torge.');
  }
  if (workflow.task['output']) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Output externo não é permitido; resultados devem retornar à Tactia.');
  }
  const actions = workflow.task['actions'];
  if (Array.isArray(actions)) {
    for (const action of actions) {
      const type = action && typeof action === 'object' && !Array.isArray(action)
        ? (action as Record<string, unknown>)['type']
        : null;
      if (typeof type === 'string' && FORBIDDEN_TORGE_ACTIONS.has(type)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `Ação não permitida no workflow Torge: ${type}.`);
      }
    }
  }
}

/** Public-safe DTO for an executor instance. Excludes any secret material. */
function instanceDto(row: {
  id: string;
  provider: string;
  engine: string;
  instanceKey: string;
  baseUrl: string;
  dedicatedConnectionId: string | null;
  apiKeyCredentialId: string;
  environment: string;
  allowInsecureHttp: boolean;
  active: boolean;
  lastHealthAt?: Date | null;
  lastHealthStatus?: string | null;
  lastHealthMessage?: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    provider: row.provider,
    engine: row.engine,
    instanceKey: row.instanceKey,
    baseUrl: row.baseUrl,
    dedicatedConnectionId: row.dedicatedConnectionId,
    apiKeyCredentialId: row.apiKeyCredentialId,
    environment: row.environment,
    allowInsecureHttp: row.allowInsecureHttp,
    active: row.active,
    lastHealthAt: row.lastHealthAt ?? null,
    lastHealthStatus: row.lastHealthStatus ?? null,
    lastHealthMessage: row.lastHealthMessage ?? null,
    createdAt: row.createdAt,
  };
}

export class BrowserIntegrationService {
  constructor(private readonly deps: BrowserIntegrationDeps) {}

  private get env(): FigraniumInstancesEnvironment {
    return this.deps.env ?? process.env;
  }

  private credentialService() {
    return new CredentialService(this.deps.credentials);
  }

  // ---------------------------------------------------------------------------
  // Executor instances
  // ---------------------------------------------------------------------------

  async createInstance(ctx: RequestContext, raw: unknown) {
    assertCanManageConnections(ctx);
    const input = createBrowserExecutorInstanceSchema.parse(raw);
    validateFigraniumBaseUrl(input.baseUrl, input.allowInsecureHttp ?? false);
    if (input.dedicatedConnectionId && this.deps.dataSources) {
      const source = await this.deps.dataSources.findOwned({
        tenantId: ctx.tenantId!,
        id: input.dedicatedConnectionId,
      });
      if (!source || source.type !== input.provider) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Conexão dedicada inválida para este provedor.');
      }
    }
    const credentials = this.credentialService();
    const credential = await credentials.create(ctx, {
      provider: `${input.engine}:${input.instanceKey}`,
      data: { apiKey: input.apiKey },
    });
    try {
      const instance = await this.deps.instances.create({
        tenantId: ctx.tenantId!,
        provider: input.provider,
        engine: input.engine,
        instanceKey: input.instanceKey,
        baseUrl: input.baseUrl,
        dedicatedConnectionId: input.dedicatedConnectionId ?? null,
        apiKeyCredentialId: credential.id,
        environment: input.environment,
        allowInsecureHttp: input.allowInsecureHttp ?? false,
      });
      await this.deps.auditLogs?.record(ctx, {
        action: AuditAction.BROWSER_INSTANCE_CREATED,
        entityType: 'browser_executor_instance',
        entityId: instance.id,
        metadata: { provider: instance.provider, engine: instance.engine, instanceKey: instance.instanceKey },
      });
      return instanceDto(instance);
    } catch (error) {
      await credentials.delete(ctx, credential.id).catch(() => undefined);
      throw error;
    }
  }

  async updateInstance(ctx: RequestContext, id: string, raw: unknown) {
    assertCanManageConnections(ctx);
    const input = updateBrowserExecutorInstanceSchema.parse(raw);
    const current = await this.deps.instances.findById({ tenantId: ctx.tenantId!, id });
    if (!current) throw new AppError(ErrorCode.NOT_FOUND, 'Instância não encontrada.');
    const baseUrl = input.baseUrl ?? current.baseUrl;
    const allowInsecureHttp = input.allowInsecureHttp ?? current.allowInsecureHttp;
    validateFigraniumBaseUrl(baseUrl, allowInsecureHttp);
    if (input.dedicatedConnectionId && this.deps.dataSources) {
      const source = await this.deps.dataSources.findOwned({ tenantId: ctx.tenantId!, id: input.dedicatedConnectionId });
      if (!source || source.type !== current.provider) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Conexão dedicada inválida para este provedor.');
      }
    }
    const credentials = this.credentialService();
    let apiKeyCredentialId: string | undefined;
    if (input.apiKey) {
      const credential = await credentials.create(ctx, {
        provider: `${current.engine}:${current.instanceKey}`,
        data: { apiKey: input.apiKey },
      });
      apiKeyCredentialId = credential.id;
    }
    try {
      const updated = await this.deps.instances.update({
        tenantId: ctx.tenantId!,
        id,
        data: {
          baseUrl: input.baseUrl,
          dedicatedConnectionId: input.dedicatedConnectionId,
          allowInsecureHttp: input.allowInsecureHttp,
          active: input.active,
          ...(apiKeyCredentialId ? { apiKeyCredentialId } : {}),
        },
      });
      if (!updated) throw new AppError(ErrorCode.NOT_FOUND, 'Instância não encontrada.');
      await this.deps.auditLogs?.record(ctx, {
        action: apiKeyCredentialId ? AuditAction.BROWSER_INSTANCE_CREDENTIAL_ROTATED : AuditAction.BROWSER_INSTANCE_UPDATED,
        entityType: 'browser_executor_instance',
        entityId: id,
        metadata: {
          baseUrlChanged: input.baseUrl !== undefined,
          dedicatedConnectionChanged: input.dedicatedConnectionId !== undefined,
          active: input.active,
        },
      });
      return instanceDto(updated);
    } catch (error) {
      if (apiKeyCredentialId) await credentials.delete(ctx, apiKeyCredentialId).catch(() => undefined);
      throw error;
    }
  }

  async listInstances(ctx: RequestContext, provider: string, environment: string) {
    assertTenantScope(ctx);
    const rows = await this.deps.instances.listActive({ tenantId: ctx.tenantId!, provider, environment });
    return rows.map(instanceDto);
  }

  async getInstance(ctx: RequestContext, id: string) {
    assertTenantScope(ctx);
    const row = await this.deps.instances.findById({ tenantId: ctx.tenantId!, id });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Instância não encontrada.');
    return instanceDto(row);
  }

  /** Disable an executor instance (soft: sets active=false). */
  async disableInstance(ctx: RequestContext, id: string) {
    assertCanManageConnections(ctx);
    const updated = await this.deps.instances.update({
      tenantId: ctx.tenantId!,
      id,
      data: { active: false },
    });
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, 'Instância não encontrada.');
    await this.deps.auditLogs?.record(ctx, {
      action: AuditAction.BROWSER_INSTANCE_DISABLED,
      entityType: 'browser_executor_instance',
      entityId: id,
    });
    return instanceDto(updated);
  }

  /** Validate executor health and API-key authentication without echoing secrets. */
  private async probe(config: { baseUrl: string; apiKey: string; allowInsecureHttp?: boolean }): Promise<BrowserHealthResult> {
    if (this.deps.healthProbe) return this.deps.healthProbe(config);
    let baseUrl: URL;
    try {
      baseUrl = validateFigraniumBaseUrl(config.baseUrl, config.allowInsecureHttp ?? false);
    } catch {
      return { healthy: false, safeMessage: 'URL do executor inválida ou não permitida.' };
    }
    try {
      const health = await fetch(new URL('/api/health', baseUrl), {
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      if (!health.ok) return { healthy: false, safeMessage: 'Executor indisponível.' };
      const authenticated = await fetch(new URL('/api/tasks/list', baseUrl), {
        headers: { 'x-api-key': config.apiKey },
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      if (authenticated.status === 401 || authenticated.status === 403) {
        return { healthy: false, safeMessage: 'API key recusada pelo executor.' };
      }
      return authenticated.ok
        ? { healthy: true, safeMessage: 'Executor disponível e API key aceita.' }
        : { healthy: false, safeMessage: 'Executor não confirmou a autenticação.' };
    } catch {
      return { healthy: false, safeMessage: 'Executor indisponível.' };
    }
  }

  /**
   * Test executor health + API key before an instance exists (wizard step). The
   * API key is used transiently for the probe and never persisted or returned.
   */
  async testHealth(ctx: RequestContext, raw: unknown): Promise<BrowserHealthResult> {
    assertCanManageConnections(ctx);
    const input = testBrowserExecutorHealthSchema.parse(raw);
    return this.probe({ baseUrl: input.baseUrl, apiKey: input.apiKey, allowInsecureHttp: input.allowInsecureHttp });
  }

  /** Test health + API key of an existing instance, re-reading its credential. */
  async testInstanceHealth(ctx: RequestContext, id: string): Promise<BrowserHealthResult> {
    assertCanManageConnections(ctx);
    const instance = await this.deps.instances.findById({ tenantId: ctx.tenantId!, id });
    if (!instance) throw new AppError(ErrorCode.NOT_FOUND, 'Instância não encontrada.');
    const apiKey = await this.readApiKey(ctx, instance.apiKeyCredentialId);
    const result = await this.probe({
      baseUrl: instance.baseUrl,
      apiKey,
      allowInsecureHttp: instance.allowInsecureHttp,
    });
    await this.deps.instances.update({
      tenantId: ctx.tenantId!,
      id,
      data: {
        lastHealthAt: new Date(),
        lastHealthStatus: result.healthy ? 'healthy' : 'unhealthy',
        lastHealthMessage: result.safeMessage,
      },
    });
    await this.deps.auditLogs?.record(ctx, {
      action: AuditAction.BROWSER_INSTANCE_TESTED,
      entityType: 'browser_executor_instance',
      entityId: id,
      metadata: { healthy: result.healthy },
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Workflows and immutable revisions
  // ---------------------------------------------------------------------------

  async importWorkflow(ctx: RequestContext, raw: unknown) {
    assertCanManageConnections(ctx);
    const input = importBrowserWorkflowSchema.parse(raw);
    validateImportedWorkflow(input.provider, input.workflow);
    const definition = JSON.parse(JSON.stringify(input.workflow)) as Record<string, unknown>;
    const { workflow, revision } = await this.deps.workflows.importRevision(
      {
        tenantId: ctx.tenantId!,
        provider: input.provider,
        engine: input.engine,
        workflowKey: input.workflow.workflowKey,
        environment: input.environment,
      },
      {
        workflowVersion: input.workflow.workflowVersion,
        definition: definition as never,
        definitionChecksum: checksumOf(definition),
        publishable: input.workflow.publishable,
        createdBy: ctx.operatorId ?? ctx.userId ?? null,
      },
    );
    await this.deps.auditLogs?.record(ctx, {
      action: AuditAction.BROWSER_WORKFLOW_IMPORTED,
      entityType: 'browser_workflow',
      entityId: workflow.id,
      metadata: {
        workflowKey: workflow.workflowKey,
        revision: revision.revision,
        checksum: revision.definitionChecksum,
      },
    });
    return {
      workflowId: workflow.id,
      revisionId: revision.id,
      revision: revision.revision,
      workflowKey: workflow.workflowKey,
      workflowVersion: revision.workflowVersion,
      publishable: revision.publishable,
    };
  }

  async listWorkflows(ctx: RequestContext, provider: string, environment: string) {
    assertTenantScope(ctx);
    const rows = await this.deps.workflows.listActive({ tenantId: ctx.tenantId!, provider, environment });
    return rows.map((row) => ({
      id: row.id,
      workflowKey: row.workflowKey,
      environment: row.environment,
      activeRevision: row.activeRevision
        ? {
            id: row.activeRevision.id,
            revision: row.activeRevision.revision,
            workflowVersion: row.activeRevision.workflowVersion,
            publishable: row.activeRevision.publishable,
          }
        : null,
    }));
  }

  /** List the immutable revision history of a workflow (newest first). */
  async listRevisions(ctx: RequestContext, workflowId: string) {
    assertTenantScope(ctx);
    const workflow = await this.deps.workflows.findById({ tenantId: ctx.tenantId!, id: workflowId });
    if (!workflow) throw new AppError(ErrorCode.NOT_FOUND, 'Fluxo não encontrado.');
    const rows = await this.deps.workflows.listRevisions({ tenantId: ctx.tenantId!, workflowId });
    return rows.map((row) => ({
      id: row.id,
      revision: row.revision,
      workflowVersion: row.workflowVersion,
      publishable: row.publishable,
      definitionChecksum: row.definitionChecksum,
      createdAt: row.createdAt,
      isActive: workflow.activeRevisionId === row.id,
    }));
  }

  /**
   * Repoint the active revision without deleting history (revert/reconcile).
   * The previous revisions remain immutable and available.
   */
  async setActiveRevision(ctx: RequestContext, raw: unknown) {
    assertCanManageConnections(ctx);
    const input = setActiveRevisionSchema.parse(raw);
    const workflow = await this.deps.workflows.setActiveRevision({
      tenantId: ctx.tenantId!,
      workflowId: input.workflowId,
      revisionId: input.revisionId,
    });
    if (!workflow || !workflow.activeRevision) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Revisão não encontrada para este fluxo.');
    }
    await this.deps.auditLogs?.record(ctx, {
      action: AuditAction.BROWSER_WORKFLOW_REVISION_ACTIVATED,
      entityType: 'browser_workflow',
      entityId: workflow.id,
      metadata: { revision: workflow.activeRevision.revision },
    });
    return {
      workflowId: workflow.id,
      activeRevision: {
        id: workflow.activeRevision.id,
        revision: workflow.activeRevision.revision,
        workflowVersion: workflow.activeRevision.workflowVersion,
        publishable: workflow.activeRevision.publishable,
      },
    };
  }

  /**
   * Publish the active revision of a workflow to a remote executor. A new remote
   * task is created per revision (the reconciliation marker embeds the revision),
   * and existing tasks with the same marker are reconciled (updated) instead of
   * duplicated. Remote scheduling is always forced off by the publisher.
   */
  async publishWorkflow(ctx: RequestContext, raw: unknown) {
    assertCanManageConnections(ctx);
    const input = publishBrowserWorkflowSchema.parse(raw);
    const workflow = await this.deps.workflows.findById({ tenantId: ctx.tenantId!, id: input.workflowId });
    if (!workflow || !workflow.activeRevision) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Fluxo sem revisão ativa.');
    }
    const instance = await this.deps.instances.findById({ tenantId: ctx.tenantId!, id: input.instanceId });
    if (!instance) throw new AppError(ErrorCode.NOT_FOUND, 'Instância não encontrada.');
    if (!instance.active || !instance.dedicatedConnectionId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Instância precisa estar ativa e dedicada antes da publicação.');
    }
    if (instance.environment !== workflow.environment || instance.provider !== workflow.provider) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Instância e fluxo em ambientes/provedores distintos.');
    }
    const revision = workflow.activeRevision;
    const apiKey = await this.readApiKey(ctx, instance.apiKeyCredentialId);
    const versioned = revision.definition as unknown as VersionedWorkflow;
    // Marker distinguishes each revision so publishing a new revision creates a
    // new remote task instead of overwriting the previous one.
    const marker = `[tactia:${workflow.workflowKey}@${revision.workflowVersion}#${revision.revision}]`;
    const publisher = this.deps.publisherFactory
      ? this.deps.publisherFactory({ baseUrl: instance.baseUrl, apiKey })
      : { publish: (wf: VersionedWorkflow, m: string) => new FigraniumWorkflowPublisher({ baseUrl: instance.baseUrl, apiKey }).publish(wf, m) };
    const result = await publisher.publish(versioned, marker);
    const binding = await this.deps.bindings.replaceActive({
      provider: workflow.provider,
      engine: workflow.engine,
      workflowKey: workflow.workflowKey,
      workflowVersion: revision.workflowVersion,
      environment: workflow.environment,
      instanceKey: instance.instanceKey,
      externalTaskId: result.taskId,
      definitionChecksum: revision.definitionChecksum,
      tenantId: ctx.tenantId!,
      reconciliationMarker: marker,
      browserExecutorInstanceId: instance.id,
      workflowRevisionId: revision.id,
    });
    logger.info({
      operation: 'browser_workflow_published',
      tenant_id: ctx.tenantId,
      workflow_key: workflow.workflowKey,
      workflow_version: revision.workflowVersion,
      instance_key: instance.instanceKey,
      result: result.operation,
    });
    await this.deps.auditLogs?.record(ctx, {
      action: AuditAction.BROWSER_WORKFLOW_PUBLISHED,
      entityType: 'browser_workflow_binding',
      entityId: binding.id,
      metadata: {
        workflowKey: workflow.workflowKey,
        revision: revision.revision,
        instanceKey: instance.instanceKey,
        operation: result.operation,
      },
    });
    return {
      bindingId: binding.id,
      taskId: result.taskId,
      operation: result.operation,
      workflowKey: workflow.workflowKey,
      workflowVersion: revision.workflowVersion,
    };
  }

  // ---------------------------------------------------------------------------
  // DB-first resolution with env fallback + snapshot
  // ---------------------------------------------------------------------------

  private async readApiKey(ctx: RequestContext, credentialId: string): Promise<string> {
    const data = await this.credentialService().getDecryptedData(ctx, credentialId);
    const apiKey = data['apiKey'];
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'Credencial da instância inválida.');
    }
    return apiKey;
  }

  /**
   * Resolve a Figranium instance DB-first for the given tenant/instanceKey and
   * fall back to FIGRANIUM_INSTANCES_JSON when no active DB instance exists.
   * Returns the executor-ready config plus an immutable, secret-free snapshot.
   */
  async resolveFigranium(
    ctx: RequestContext,
    args: { provider: string; environment: string; instanceKey: string; sourceCredentialId?: string | null },
  ): Promise<{ resolved: ResolvedFigraniumInstance; snapshot: BrowserSyncSnapshot }> {
    assertTenantScope(ctx);
    const engine = 'figranium';
    const instance = await this.deps.instances.findByKey({
      tenantId: ctx.tenantId!,
      provider: args.provider,
      engine,
      instanceKey: args.instanceKey,
      environment: args.environment,
    });

    if (instance) {
      if (!instance.active) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Instância desabilitada no BKO.');
      }
      if (!instance.dedicatedConnectionId) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Instância sem conexão dedicada configurada.');
      }
      const apiKey = await this.readApiKey(ctx, instance.apiKeyCredentialId);
      const bindings = await this.deps.bindings.listActiveForTenant({
        tenantId: ctx.tenantId!,
        provider: args.provider,
        environment: args.environment,
        instanceKey: args.instanceKey,
      });
      const workflows: FigraniumWorkflowBinding[] = bindings.map((b) => ({
        workflowKey: b.workflowKey,
        workflowVersion: b.workflowVersion,
        taskId: b.externalTaskId,
      }));
      const resolved: ResolvedFigraniumInstance = {
        instanceKey: instance.instanceKey,
        baseUrl: instance.baseUrl,
        apiKey,
        dedicatedConnectionId: instance.dedicatedConnectionId,
        allowInsecureHttp: instance.allowInsecureHttp,
        workflows,
      };
      const snapshot: BrowserSyncSnapshot = {
        engine,
        provider: args.provider,
        instanceKey: instance.instanceKey,
        environment: args.environment,
        baseUrl: instance.baseUrl,
        allowInsecureHttp: instance.allowInsecureHttp,
        dedicatedConnectionId: instance.dedicatedConnectionId,
        apiKeyCredentialId: instance.apiKeyCredentialId,
        sourceCredentialId: args.sourceCredentialId ?? null,
        source: 'database',
        workflows: workflows.map((w) => ({ workflowKey: w.workflowKey, workflowVersion: w.workflowVersion, taskId: w.taskId })),
      };
      return { resolved, snapshot };
    }

    logger.warn({
      operation: 'browser_config_env_fallback',
      tenant_id: ctx.tenantId,
      provider: args.provider,
      instance_key: args.instanceKey,
    });
    const config = figraniumConfigFromEnv(args.instanceKey, this.env);
    const resolved: ResolvedFigraniumInstance = {
      instanceKey: config.instanceKey,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      dedicatedConnectionId: config.dedicatedConnectionId,
      allowInsecureHttp: config.allowInsecureHttp ?? false,
      workflows: config.workflows,
    };
    const snapshot: BrowserSyncSnapshot = {
      engine,
      provider: args.provider,
      instanceKey: config.instanceKey,
      environment: args.environment,
      baseUrl: config.baseUrl,
      allowInsecureHttp: config.allowInsecureHttp ?? false,
      dedicatedConnectionId: config.dedicatedConnectionId,
      apiKeyCredentialId: '',
      sourceCredentialId: args.sourceCredentialId ?? null,
      source: 'env',
      workflows: config.workflows.map((w) => ({ workflowKey: w.workflowKey, workflowVersion: w.workflowVersion, taskId: w.taskId })),
    };
    return { resolved, snapshot };
  }

  /**
   * Rebuild an executor-ready config from a previously recorded snapshot.
   * Used on retries so the exact same instance/bindings are reused. The API key
   * is re-read from the referenced credential (DB path) or the env (env path);
   * the secret is never stored in the snapshot itself.
   */
  async resolveFromSnapshot(
    ctx: RequestContext,
    snapshot: BrowserSyncSnapshot,
  ): Promise<ResolvedFigraniumInstance> {
    assertTenantScope(ctx);
    const workflows: FigraniumWorkflowBinding[] = snapshot.workflows.map((w) => ({
      workflowKey: w.workflowKey,
      workflowVersion: w.workflowVersion,
      taskId: w.taskId,
    }));
    if (snapshot.source === 'database') {
      const apiKey = await this.readApiKey(ctx, snapshot.apiKeyCredentialId);
      return {
        instanceKey: snapshot.instanceKey,
        baseUrl: snapshot.baseUrl,
        apiKey,
        dedicatedConnectionId: snapshot.dedicatedConnectionId,
        allowInsecureHttp: snapshot.allowInsecureHttp,
        workflows,
      };
    }
    const config = figraniumConfigFromEnv(snapshot.instanceKey, this.env);
    return {
      instanceKey: snapshot.instanceKey,
      baseUrl: snapshot.baseUrl,
      apiKey: config.apiKey,
      dedicatedConnectionId: snapshot.dedicatedConnectionId,
      allowInsecureHttp: snapshot.allowInsecureHttp,
      workflows,
    };
  }
}
