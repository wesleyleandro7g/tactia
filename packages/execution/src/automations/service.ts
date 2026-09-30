import {
  assertConnectionAllowed,
  assertOperator,
  assertRole,
  assertTenantContext,
  assertVersionBody,
  checksumBuffer,
  decideEmailEffect,
  fingerprint,
  hasMinRole,
  pickReleasedDefaults,
  AUTOMATION_TEMPLATES,
  resolveAutomationParams,
  SYNC_COMPLETED_EVENT,
  validateReportBundle,
  assertWebhookSignature,
  type AutomationOriginName,
  type AutomationStepDefinition,
  type AutomationVersionBody,
} from '@tactia/domain';
import { AppError, ErrorCode, createId, logger, type RequestContext } from '@tactia/shared';
import { isUncertainEmailError } from './email-uncertainty';
import type { AutomationStore, RunRow, StepRow, VersionRow } from './records';
import type {
  AutomationArtifactStorage,
  AutomationBrowserPort,
  AutomationEffectPort,
  ScheduleCompletionSink,
  SecretCipher,
  WorkflowRevisionPin,
} from './ports';
import { plainCipher } from './ports';

const MAX_ATTEMPTS = 3;
const LEASE_MS = 2 * 60 * 1000;
const LOCK_TTL_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 15_000;

type AuditRecorder = {
  record(
    ctx: RequestContext,
    entry: { action: string; entityType: string; entityId: string; actorType?: string; metadata?: Record<string, unknown> },
  ): Promise<void>;
};

export type AutomationServiceDeps = {
  store: AutomationStore;
  browser: AutomationBrowserPort;
  effects: AutomationEffectPort;
  storage: AutomationArtifactStorage;
  audit?: AuditRecorder;
  schedules?: ScheduleCompletionSink;
  revisions?: WorkflowRevisionPin;
  cipher?: SecretCipher;
  now?: () => Date;
  emailDriver?: (tenantId: string) => Promise<string>;
  publish?: (job: { tenantId: string; runId: string; startAfterMs?: number }) => Promise<void>;
  /** Duração da posse. Testes usam um intervalo curto. */
  leaseMs?: number;
};

export type StartAutomationInput = {
  automationId: string;
  params: Record<string, unknown>;
  origin: AutomationOriginName;
  originRef?: string | null;
  idempotencyKey: string;
  /** Conteúdo bruto do disparo. A mesma chave com conteúdo diferente é conflito. */
  content?: string | null;
  scheduleOccurrenceId?: string | null;
  forceApproval?: boolean;
  operatorTest?: boolean;
};

type StepOutcome =
  | { type: 'completed'; output?: Record<string, unknown> }
  | { type: 'failed'; error: string; retryable: boolean }
  | { type: 'needs_attention'; error: string }
  | { type: 'awaiting_approval'; actionExecutionId: string; approvalId: string | null; output: Record<string, unknown> }
  | { type: 'effect_pending'; actionExecutionId: string; approvalId: string | null; output: Record<string, unknown> }
  | { type: 'deferred' };

const OPEN_EFFECTS = new Set(['pending', 'approved', 'running', 'in_progress']);

function isOpenEffect(status: string): boolean {
  return OPEN_EFFECTS.has(status);
}

function sendGeneration(step: { output: Record<string, unknown> | null }): number {
  const value = step.output?.['sendGeneration'];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function reconciliationOf(output: Record<string, unknown> | null): { decision: 'confirmed' | 'not_sent'; at: string } | null {
  const value = output?.['reconciliation'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row['decision'] !== 'confirmed' && row['decision'] !== 'not_sent') return null;
  return { decision: row['decision'], at: typeof row['at'] === 'string' ? row['at'] : '' };
}

export class AutomationService {
  private readonly aborts = new Map<string, AbortController>();
  private readonly leaseMs: number;

  constructor(private readonly deps: AutomationServiceDeps) {
    this.leaseMs = deps.leaseMs ?? LEASE_MS;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private cipher(): SecretCipher {
    return this.deps.cipher ?? plainCipher;
  }

  private async audit(ctx: RequestContext, action: string, entityId: string, metadata?: Record<string, unknown>) {
    await this.deps.audit?.record(ctx, {
      action,
      entityType: 'automation',
      entityId,
      ...(ctx.operatorId ? { actorType: 'operator' } : {}),
      ...(metadata ? { metadata } : {}),
    });
  }

  private assertReader(ctx: RequestContext): asserts ctx is RequestContext & { tenantId: string } {
    if (!ctx.tenantId || !ctx.role) {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
    }
    if (ctx.userId || ctx.operatorId) assertRole(ctx, 'viewer');
  }

  private assertExecutor(ctx: RequestContext): asserts ctx is RequestContext & { tenantId: string } {
    if (!ctx.tenantId || !ctx.role) {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
    }
    if (ctx.userId || ctx.operatorId) assertRole(ctx, 'member');
  }

  private async assertAvailable(ctx: RequestContext, operatorTest = false): Promise<void> {
    if (!ctx.tenantId) {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
    }
    if (operatorTest) {
      assertOperator(ctx);
      return;
    }
    if (!(await this.deps.store.isEnabled(ctx.tenantId))) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Automações não estão habilitadas para esta empresa.');
    }
  }

  async list(ctx: RequestContext) {
    this.assertReader(ctx);
    await this.assertAvailable(ctx, Boolean(ctx.operatorId));
    const automations = await this.deps.store.listAutomations(ctx.tenantId);
    const timezone = await this.deps.store.tenantTimezone(ctx.tenantId);
    const items = [];
    for (const automation of automations) {
      if (automation.status === 'draft' && !ctx.operatorId) continue;
      const latest = await this.deps.store.latestRun(ctx.tenantId, automation.id);
      const schedules = await this.deps.store.listSchedules(ctx.tenantId, automation.id);
      const next = schedules.find((schedule) => schedule.enabled && schedule.frequency !== 'manual');
      items.push({
        id: automation.id,
        name: automation.name,
        purpose: automation.purpose,
        status: automation.status,
        componentKey: automation.componentKey,
        lastRun: latest
          ? { id: latest.id, status: latest.status, finishedAt: latest.finishedAt, createdAt: latest.createdAt }
          : null,
        nextSchedule: next
          ? {
              id: next.id,
              name: next.name,
              frequency: next.frequency,
              localTime: next.recurrenceConfig.localTime ?? null,
              timezone: next.timezone ?? timezone,
            }
          : null,
      });
    }
    return { items };
  }

  async get(ctx: RequestContext, id: string) {
    this.assertReader(ctx);
    await this.assertAvailable(ctx, Boolean(ctx.operatorId));
    const automation = await this.requireAutomation(ctx.tenantId, id);
    if (automation.status === 'draft' && !ctx.operatorId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Automação não encontrada.');
    }
    const published = automation.publishedVersionId
      ? await this.deps.store.findVersion(ctx.tenantId, automation.publishedVersionId)
      : null;
    const latest = ctx.operatorId ? await this.deps.store.findLatestVersion(ctx.tenantId, id) : null;
    const version = ctx.operatorId ? (latest ?? published) : published;
    const listed = await this.deps.store.listRuns(ctx.tenantId, id, 20);
    for (const run of listed) {
      if (run.status === 'awaiting_approval' || run.status === 'running') {
        await this.reconcileSettledEffects(ctx.tenantId, run.id);
      }
    }
    const runs = await this.deps.store.listRuns(ctx.tenantId, id, 20);
    const triggers = await this.deps.store.listTriggers(ctx.tenantId, id);
    return {
      automation,
      version,
      triggers: triggers.map((trigger) => ({
        id: trigger.id,
        kind: trigger.kind,
        enabled: trigger.enabled,
        eventType: trigger.eventType,
        connectionId: trigger.connectionId,
      })),
      runs: await Promise.all(runs.map((run) => this.view(run))),
    };
  }

  async getRun(ctx: RequestContext, automationId: string, runId: string) {
    this.assertReader(ctx);
    await this.assertAvailable(ctx, Boolean(ctx.operatorId));
    const run = await this.requireRun(ctx.tenantId, runId);
    if (run.automationId !== automationId) throw new AppError(ErrorCode.NOT_FOUND, 'Execução não encontrada.');
    if (run.status === 'awaiting_approval' || run.status === 'running') {
      await this.reconcileSettledEffects(ctx.tenantId, run.id);
    }
    const fresh = (await this.deps.store.findRun(ctx.tenantId, runId)) ?? run;
    return this.view(fresh);
  }

  async readArtifact(ctx: RequestContext, artifactId: string) {
    this.assertReader(ctx);
    await this.assertAvailable(ctx, Boolean(ctx.operatorId));
    const artifact = await this.deps.store.findArtifact(ctx.tenantId, artifactId);
    if (!artifact) throw new AppError(ErrorCode.NOT_FOUND, 'Arquivo não encontrado.');
    const object = await this.deps.storage.get(artifact.storageKey);
    return { artifact, body: object.body };
  }

  async updateReleasedParameters(ctx: RequestContext, automationId: string, patch: Record<string, unknown>) {
    assertRole(ctx, 'admin');
    await this.assertAvailable(ctx, Boolean(ctx.operatorId));
    const automation = await this.requireAutomation(ctx.tenantId, automationId);
    if (!automation.publishedVersionId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Publique a automação antes de configurar parâmetros.');
    }
    const version = await this.requireVersion(ctx.tenantId, automation.publishedVersionId);
    const released = pickReleasedDefaults(version.inputSchema, patch);
    const parameterDefaults = { ...automation.parameterDefaults, ...released };
    await this.deps.store.updateAutomation(ctx.tenantId, automationId, { parameterDefaults });
    await this.audit(ctx, 'AUTOMATION_UPDATED', automationId, { fields: Object.keys(released) });
    return { id: automationId, parameterDefaults };
  }

  async createDraft(
    ctx: RequestContext,
    input: string | { templateKey?: string; definition?: AutomationVersionBody; name?: string; purpose?: string; componentKey?: string | null },
  ) {
    assertOperator(ctx);
    assertTenantContext(ctx);
    const request = typeof input === 'string' ? { templateKey: input } : input;
    const template = request.templateKey ? AUTOMATION_TEMPLATES[request.templateKey as keyof typeof AUTOMATION_TEMPLATES] : undefined;
    if (request.templateKey && !template && !request.definition) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Modelo de automação desconhecido.');
    }
    if (!template && !request.definition) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Informe um modelo ou uma definição estruturada.');
    }
    const body = request.definition ?? template!.body();
    assertVersionBody(body);
    const meta = template?.meta;
    const now = this.now();
    const automationId = createId();
    const versionId = createId();
    await this.deps.store.insertAutomation({
      id: automationId,
      tenantId: ctx.tenantId,
      key: `${meta?.key ?? 'custom'}-${automationId.slice(0, 8)}`,
      name: request.name ?? meta?.name ?? 'Automação',
      purpose: request.purpose ?? meta?.purpose ?? 'Definição estruturada.',
      status: 'draft',
      publishedVersionId: null,
      componentKey: request.componentKey === undefined ? (meta?.componentKey ?? null) : request.componentKey,
      parameterDefaults: {},
      createdAt: now,
      updatedAt: now,
    });
    await this.deps.store.insertVersion({
      id: versionId,
      tenantId: ctx.tenantId,
      automationId,
      version: 1,
      ...body,
      publishedAt: null,
      createdAt: now,
    });
    await this.audit(ctx, 'AUTOMATION_CREATED', automationId, {
      ...(request.templateKey ? { templateKey: request.templateKey } : { structured: true }),
    });
    return { id: automationId, versionId, status: 'draft' as const };
  }

  async updateDraft(ctx: RequestContext, automationId: string, body: AutomationVersionBody & { name?: string; purpose?: string }) {
    assertOperator(ctx);
    assertTenantContext(ctx);
    assertVersionBody(body);
    const automation = await this.requireAutomation(ctx.tenantId, automationId);
    const latestNumber = await this.deps.store.latestVersionNumber(automationId);
    const versionId = createId();
    await this.deps.store.insertVersion({
      id: versionId,
      tenantId: ctx.tenantId,
      automationId,
      version: latestNumber + 1,
      inputSchema: body.inputSchema,
      outputSchema: body.outputSchema,
      steps: body.steps,
      pageConfig: body.pageConfig,
      authorizationPolicy: body.authorizationPolicy,
      publishedAt: null,
      createdAt: this.now(),
    });
    await this.deps.store.updateAutomation(ctx.tenantId, automationId, {
      ...(body.name ? { name: body.name } : {}),
      ...(body.purpose ? { purpose: body.purpose } : {}),
    });
    await this.audit(ctx, 'AUTOMATION_UPDATED', automationId, { versionId });
    return { id: automationId, versionId };
  }

  async publish(ctx: RequestContext, automationId: string, versionId: string) {
    assertOperator(ctx);
    assertTenantContext(ctx);
    const version = await this.requireVersion(ctx.tenantId, versionId);
    if (version.automationId !== automationId) throw new AppError(ErrorCode.NOT_FOUND, 'Versão não encontrada.');
    const steps = await this.pinSteps(ctx.tenantId, version.steps);
    assertVersionBody({ ...version, steps });
    const published: VersionRow = { ...version, steps, publishedAt: this.now() };
    await this.deps.store.saveVersion(published);
    await this.deps.store.updateAutomation(ctx.tenantId, automationId, {
      status: 'published',
      publishedVersionId: version.id,
    });
    await this.audit(ctx, 'AUTOMATION_PUBLISHED', automationId, { versionId });
    return { id: automationId, versionId, status: 'published' as const };
  }

  async pause(ctx: RequestContext, automationId: string) {
    assertOperator(ctx);
    assertTenantContext(ctx);
    await this.requireAutomation(ctx.tenantId, automationId);
    await this.deps.store.updateAutomation(ctx.tenantId, automationId, { status: 'paused' });
    await this.audit(ctx, 'AUTOMATION_PAUSED', automationId);
    return { id: automationId, status: 'paused' as const };
  }

  async resumePublication(ctx: RequestContext, automationId: string) {
    assertOperator(ctx);
    assertTenantContext(ctx);
    const automation = await this.requireAutomation(ctx.tenantId, automationId);
    if (!automation.publishedVersionId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Não há versão publicada para retomar.');
    }
    await this.deps.store.updateAutomation(ctx.tenantId, automationId, { status: 'published' });
    await this.audit(ctx, 'AUTOMATION_PUBLISHED', automationId, { resumed: true });
    return { id: automationId, status: 'published' as const };
  }

  async setTenantEnabled(ctx: RequestContext, enabled: boolean) {
    assertOperator(ctx);
    assertTenantContext(ctx);
    await this.deps.store.setEnabled(ctx.tenantId, enabled);
    await this.audit(ctx, enabled ? 'AUTOMATION_ENABLED' : 'AUTOMATION_DISABLED', ctx.tenantId);
    return { enabled };
  }

  async createTrigger(
    ctx: RequestContext,
    automationId: string,
    input: { kind: 'webhook' | 'internal_event'; eventType?: string; connectionId?: string },
  ) {
    assertRole(ctx, 'admin');
    await this.assertAvailable(ctx, Boolean(ctx.operatorId));
    await this.requireAutomation(ctx.tenantId, automationId);
    if (input.kind === 'internal_event') {
      if (input.eventType !== SYNC_COMPLETED_EVENT || !input.connectionId) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'O evento interno exige sync.completed e a conexão de origem.',
        );
      }
    }
    const secret = input.kind === 'webhook' ? createId() + createId() : null;
    const row = {
      id: createId(),
      tenantId: ctx.tenantId,
      automationId,
      kind: input.kind,
      enabled: true,
      secretCipher: secret ? this.cipher().encrypt(secret) : null,
      eventType: input.eventType ?? null,
      connectionId: input.connectionId ?? null,
      createdAt: this.now(),
    };
    await this.deps.store.insertTrigger(row);
    await this.audit(ctx, 'AUTOMATION_TRIGGER_CREATED', row.id, { kind: input.kind });
    return { id: row.id, kind: row.kind, ...(secret ? { secret } : {}) };
  }

  async setTriggerEnabled(ctx: RequestContext, automationId: string, triggerId: string, enabled: boolean) {
    assertRole(ctx, 'admin');
    const trigger = await this.deps.store.findTrigger(triggerId);
    if (!trigger || trigger.tenantId !== ctx.tenantId || trigger.automationId !== automationId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Gatilho não encontrado.');
    }
    await this.deps.store.updateTrigger(ctx.tenantId, triggerId, { enabled });
    return { id: triggerId, enabled };
  }

  async start(ctx: RequestContext, input: StartAutomationInput) {
    this.assertExecutor(ctx);
    await this.assertAvailable(ctx, input.operatorTest);
    const automation = await this.requireAutomation(ctx.tenantId, input.automationId);
    if (automation.status !== 'published' || !automation.publishedVersionId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'A automação não está publicada.');
    }
    const version = await this.requireVersion(ctx.tenantId, automation.publishedVersionId);
    const params = resolveAutomationParams(version.inputSchema, automation.parameterDefaults, input.params);
    const contentHash = fingerprint({ params, content: input.content ?? null });
    const existing = await this.deps.store.findRunByIdempotency(
      ctx.tenantId,
      automation.id,
      input.idempotencyKey,
    );
    if (existing) return this.sameOrConflict(existing, contentHash);

    const now = this.now();
    const runId = createId();
    const steps: StepRow[] = version.steps.map((step, ordinal) => ({
      id: createId(),
      tenantId: ctx.tenantId,
      runId,
      stepKey: step.key,
      ordinal,
      status: 'pending',
      attempt: 0,
      input: {},
      output: null,
      error: null,
      retryable: step.retryable,
      reconciled: false,
      actionExecutionId: null,
      approvalId: null,
      externalExecutionId: null,
      startedAt: null,
      finishedAt: null,
    }));
    const run: RunRow = {
      id: runId,
      tenantId: ctx.tenantId,
      automationId: automation.id,
      versionId: version.id,
      status: 'queued',
      origin: input.origin,
      originRef: input.originRef ?? null,
      idempotencyKey: input.idempotencyKey,
      contentHash,
      params,
      summary: null,
      error: null,
      requestedBy: ctx.userId,
      scheduleOccurrenceId: input.scheduleOccurrenceId ?? null,
      cancelRequested: false,
      forceApproval: input.forceApproval === true,
      leaseOwner: null,
      leaseUntil: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await this.deps.store.insertRunBundle({
      run,
      steps,
      outbox: {
        id: createId(),
        tenantId: ctx.tenantId,
        runId,
        status: 'pending',
        availableAt: now,
        publishedAt: null,
        updatedAt: now,
      },
    });
    if (inserted === 'duplicate') {
      const winner = await this.deps.store.findRunByIdempotency(ctx.tenantId, automation.id, input.idempotencyKey);
      if (!winner) throw new AppError(ErrorCode.CONFLICT, 'Disparo duplicado sem execução.');
      return this.sameOrConflict(winner, contentHash);
    }
    await this.audit(ctx, 'AUTOMATION_RUN_STARTED', runId, { origin: input.origin, automationId: automation.id });
    await this.dispatch();
    const stored = await this.deps.store.findRun(ctx.tenantId, runId);
    return this.view(stored ?? run);
  }

  async acceptWebhook(
    triggerId: string,
    headers: { timestamp: string | null; signature: string | null; eventId: string | null },
    rawBody: string,
  ) {
    const trigger = await this.deps.store.findTrigger(triggerId);
    if (!trigger || trigger.kind !== 'webhook' || !trigger.enabled || !trigger.secretCipher) {
      throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Gatilho não encontrado.');
    }
    assertWebhookSignature({
      secret: this.cipher().decrypt(trigger.secretCipher),
      timestamp: headers.timestamp,
      signature: headers.signature,
      body: rawBody,
      now: this.now(),
    });
    if (!headers.eventId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Identificador do evento ausente.');
    let params: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
      params = parsed as Record<string, unknown>;
    } catch {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Corpo do webhook inválido.');
    }
    return this.start(this.systemContext(trigger.tenantId), {
      automationId: trigger.automationId,
      params,
      origin: 'webhook',
      originRef: headers.eventId,
      idempotencyKey: `webhook:${trigger.id}:${headers.eventId}`,
      content: rawBody,
    });
  }

  async recordSyncCompleted(event: { tenantId: string; dataSourceId: string; syncJobId: string; status: string }) {
    if (event.status !== 'completed') return { recorded: false };
    await this.deps.store.insertDomainEvent({
      id: createId(),
      tenantId: event.tenantId,
      type: SYNC_COMPLETED_EVENT,
      sourceId: event.syncJobId,
      connectionId: event.dataSourceId,
      dispatchedAt: null,
      createdAt: this.now(),
    });
    return { recorded: true };
  }

  async dispatchDomainEvents() {
    const events = await this.deps.store.listPendingDomainEvents(50);
    let started = 0;
    for (const event of events) {
      if (event.type !== SYNC_COMPLETED_EVENT) {
        await this.deps.store.markDomainEventDispatched(event.id, this.now());
        continue;
      }
      const triggers = await this.deps.store.listEventTriggers(event.type, event.connectionId);
      let failed = false;
      for (const trigger of triggers) {
        if (!(await this.deps.store.isEnabled(trigger.tenantId))) continue;
        try {
          await this.start(this.systemContext(trigger.tenantId), {
            automationId: trigger.automationId,
            params: {},
            origin: 'internal_event',
            originRef: event.sourceId,
            idempotencyKey: `${event.type}:${event.sourceId}:${trigger.automationId}`,
          });
          started += 1;
        } catch (error) {
          failed = true;
          logger.error({
            operation: 'automation_event_start_failed',
            tenant_id: trigger.tenantId,
            automation_id: trigger.automationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!failed) await this.deps.store.markDomainEventDispatched(event.id, this.now());
    }
    const pending = (await this.deps.store.listPendingDomainEvents(50)).length;
    return { started, pending };
  }

  async cancel(ctx: RequestContext, automationId: string, runId: string) {
    this.assertExecutor(ctx);
    const run = await this.requireOwnedRun(ctx, automationId, runId);
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      throw new AppError(ErrorCode.CONFLICT, 'Esta execução já foi encerrada.');
    }
    await this.deps.store.updateRun(ctx.tenantId, runId, { cancelRequested: true });
    this.aborts.get(runId)?.abort();
    const steps = await this.deps.store.listSteps(ctx.tenantId, runId);
    const active = steps.find((step) => step.externalExecutionId && step.status === 'running');
    if (active?.externalExecutionId) await this.deps.browser.cancel?.(active.externalExecutionId);
    const waiting = steps.find((step) => step.status === 'awaiting_approval' && step.actionExecutionId);
    if (waiting?.actionExecutionId) await this.deps.effects.cancel?.(ctx.tenantId, waiting.actionExecutionId);
    if (run.status === 'queued' || run.status === 'awaiting_approval' || run.status === 'needs_attention') {
      await this.finish(ctx.tenantId, run, 'cancelled', 'Execução cancelada.');
    }
    await this.audit(ctx, 'AUTOMATION_RUN_CANCELLED', runId);
    const fresh = await this.deps.store.findRun(ctx.tenantId, runId);
    return this.view(fresh ?? run);
  }

  async resume(ctx: RequestContext, automationId: string, runId: string) {
    assertRole(ctx, 'member');
    const run = await this.requireOwnedRun(ctx, automationId, runId);
    if (run.status !== 'failed') {
      throw new AppError(ErrorCode.CONFLICT, 'Só uma execução que falhou pode ser retomada.');
    }
    const steps = await this.deps.store.listSteps(ctx.tenantId, runId);
    const failed = steps.find((step) => step.status === 'failed');
    if (!failed) throw new AppError(ErrorCode.CONFLICT, 'Nenhuma etapa para retomar.');
    const generation = sendGeneration(failed) + 1;
    await this.deps.store.updateStep(ctx.tenantId, failed.id, {
      status: 'pending',
      error: null,
      finishedAt: null,
      actionExecutionId: null,
      approvalId: null,
      output: { ...(failed.output ?? {}), sendGeneration: generation },
    });
    await this.deps.store.requeueRun(ctx.tenantId, runId, this.now());
    await this.dispatch();
    const fresh = await this.deps.store.findRun(ctx.tenantId, runId);
    return this.view(fresh ?? run);
  }

  async reconcile(
    ctx: RequestContext,
    automationId: string,
    runId: string,
    decision: 'confirmed' | 'not_sent',
  ) {
    assertRole(ctx, 'admin');
    const run = await this.requireRun(ctx.tenantId, runId);
    if (run.automationId !== automationId) throw new AppError(ErrorCode.NOT_FOUND, 'Execução não encontrada.');
    if (run.status !== 'needs_attention') {
      throw new AppError(ErrorCode.CONFLICT, 'Só uma execução que requer atenção pode ser reconciliada.');
    }
    const steps = await this.deps.store.listSteps(ctx.tenantId, runId);
    const blocked = steps.find((step) => step.status === 'needs_attention');
    if (!blocked) throw new AppError(ErrorCode.CONFLICT, 'Nenhuma etapa para reconciliar.');
    const record = {
      decision,
      at: this.now().toISOString(),
      actorId: ctx.userId ?? ctx.operatorId,
    };
    if (decision === 'confirmed') {
      await this.deps.store.updateStep(ctx.tenantId, blocked.id, {
        status: 'completed',
        reconciled: true,
        error: null,
        finishedAt: this.now(),
        output: { ...(blocked.output ?? {}), reconciliation: record },
      });
    } else {
      const generation = sendGeneration(blocked) + 1;
      await this.deps.store.updateStep(ctx.tenantId, blocked.id, {
        status: 'pending',
        reconciled: true,
        error: null,
        finishedAt: null,
        actionExecutionId: null,
        approvalId: null,
        output: { ...(blocked.output ?? {}), sendGeneration: generation, reconciliation: record },
      });
    }
    await this.deps.store.requeueRun(ctx.tenantId, runId, this.now());
    await this.audit(ctx, 'AUTOMATION_RECONCILED', runId, record);
    await this.dispatch();
    const fresh = await this.deps.store.findRun(ctx.tenantId, runId);
    return this.view(fresh ?? run);
  }

  async onExecutionSettled(tenantId: string, actionExecutionId: string) {
    await this.settleEffect(tenantId, actionExecutionId);
  }

  async dispatch() {
    const now = this.now();
    const rows = await this.deps.store.claimOutbox(now, 25);
    for (const row of rows) {
      try {
        await this.deps.publish?.({ tenantId: row.tenantId, runId: row.runId });
        await this.deps.store.markOutbox(row.id, 'dispatched', now);
      } catch (error) {
        await this.deps.store.markOutbox(row.id, 'pending', now);
        logger.error({
          operation: 'automation_dispatch_failed',
          tenant_id: row.tenantId,
          run_id: row.runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const counts = await this.deps.store.countRuns();
    logger.info({ operation: 'automation_queue', dispatched: rows.length, ...counts });
    return { dispatched: rows.length, counts };
  }

  async recoverAndDispatch() {
    const recovered = await this.deps.store.recover(this.now());
    const dispatched = await this.dispatch();
    return { recovered, ...dispatched };
  }

  async execute(tenantId: string, runId: string): Promise<'done' | 'deferred' | 'busy' | 'parked'> {
    const workerId = createId();
    const now = this.now();
    const claimed = await this.deps.store.claimRun(
      tenantId,
      runId,
      workerId,
      new Date(now.getTime() + this.leaseMs),
      now,
    );
    if (!claimed) return 'busy';
    const controller = new AbortController();
    this.aborts.set(runId, controller);
    const started = Date.now();
    try {
      return await this.runClaimed(claimed, controller.signal, workerId);
    } finally {
      this.aborts.delete(runId);
      logger.info({
        operation: 'automation_execute',
        tenant_id: tenantId,
        run_id: runId,
        duration_ms: Date.now() - started,
      });
    }
  }

  private async runClaimed(run: RunRow, signal: AbortSignal, workerId: string): Promise<'done' | 'deferred' | 'parked'> {
    const version = await this.requireVersion(run.tenantId, run.versionId);
    const steps = await this.deps.store.listSteps(run.tenantId, run.id);
    for (const step of steps) {
      if (!(await this.keepLease(run.tenantId, run.id, workerId))) return 'deferred';
      const current = await this.deps.store.findRun(run.tenantId, run.id);
      if (current?.cancelRequested) {
        await this.finish(run.tenantId, run, 'cancelled', 'Execução cancelada.');
        return 'done';
      }
      if (step.status === 'completed' || step.status === 'skipped') continue;
      if (step.status === 'cancelled') {
        await this.finish(run.tenantId, run, 'cancelled', step.error);
        return 'done';
      }
      if (step.status === 'needs_attention' && !step.reconciled) {
        await this.park(run, 'needs_attention', step.error);
        return 'parked';
      }
      if (step.status === 'awaiting_approval' || (step.status === 'running' && step.actionExecutionId)) {
        const settled = await this.applySettlement(run, step);
        if (settled === 'wait') {
          await this.releaseLease(run);
          if (step.status === 'awaiting_approval') await this.park(run, 'awaiting_approval', null);
          return 'parked';
        }
        if (settled === 'effect_pending') {
          await this.parkEffect(run, step);
          return 'parked';
        }
        if (settled === 'stop') return 'done';
        continue;
      }
      const definition = version.steps.find((item) => item.key === step.stepKey);
      if (!definition) {
        await this.fail(run, `Etapa ${step.stepKey} não existe nesta versão.`);
        return 'done';
      }
      if (step.status === 'running' && !definition.retryable) {
        await this.markAttention(run, step, 'A etapa externa foi interrompida sem confirmação de envio.');
        return 'parked';
      }
      if (step.status === 'failed') {
        await this.fail(run, step.error ?? 'Etapa falhou.');
        return 'done';
      }

      if (definition.kind === 'browser_workflow' && definition.connectionId) {
        const locked = await this.deps.store.tryAcquireLock(
          definition.connectionId,
          run.tenantId,
          run.id,
          this.now(),
          LOCK_TTL_MS,
        );
        if (!locked) {
          await this.deps.store.requeueRun(run.tenantId, run.id, new Date(this.now().getTime() + RETRY_DELAY_MS));
          await this.deps.publish?.({ tenantId: run.tenantId, runId: run.id, startAfterMs: RETRY_DELAY_MS });
          return 'deferred';
        }
      }

      if (!(await this.keepLease(run.tenantId, run.id, workerId))) return 'deferred';
      await this.deps.store.updateStep(run.tenantId, step.id, {
        status: 'running',
        attempt: step.attempt + 1,
        startedAt: step.startedAt ?? this.now(),
        error: null,
      });
      const attempt = step.attempt + 1;
      const heartbeat = setInterval(() => {
        void this.keepLease(run.tenantId, run.id, workerId);
        if (definition.kind === 'browser_workflow' && definition.connectionId) {
          void this.deps.store.renewLock(definition.connectionId, run.id, this.now());
        }
      }, Math.max(20, Math.floor(this.leaseMs / 3)));
      let outcome: StepOutcome;
      try {
        outcome = await this.executeStep(run, version, { ...step, attempt }, definition, signal, workerId);
      } finally {
        clearInterval(heartbeat);
        if (definition.kind === 'browser_workflow' && definition.connectionId) {
          await this.deps.store.releaseLock(definition.connectionId, run.id);
        }
      }
      if (!(await this.keepLease(run.tenantId, run.id, workerId))) return 'deferred';
      if (outcome.type === 'deferred') return 'deferred';
      if (outcome.type === 'awaiting_approval' || outcome.type === 'effect_pending') {
        await this.deps.store.updateStep(run.tenantId, step.id, {
          status: outcome.type === 'awaiting_approval' ? 'awaiting_approval' : 'running',
          actionExecutionId: outcome.actionExecutionId,
          approvalId: outcome.approvalId,
          output: outcome.output,
        });
        if (outcome.type === 'awaiting_approval') {
          await this.park(run, 'awaiting_approval', null);
        } else {
          await this.deps.store.updateRun(run.tenantId, run.id, {
            status: 'running',
            error: null,
            leaseOwner: null,
            leaseUntil: null,
          });
        }
        return 'parked';
      }
      if (outcome.type === 'needs_attention') {
        await this.markAttention(run, step, outcome.error);
        return 'parked';
      }
      if (outcome.type === 'failed') {
        const retry = outcome.retryable && definition.retryable && attempt < MAX_ATTEMPTS;
        await this.deps.store.updateStep(run.tenantId, step.id, {
          status: retry ? 'pending' : 'failed',
          error: outcome.error,
          finishedAt: retry ? null : this.now(),
        });
        if (retry) {
          await this.deps.store.requeueRun(run.tenantId, run.id, new Date(this.now().getTime() + RETRY_DELAY_MS));
          await this.deps.publish?.({ tenantId: run.tenantId, runId: run.id, startAfterMs: RETRY_DELAY_MS });
          return 'deferred';
        }
        await this.fail(run, outcome.error);
        return 'done';
      }
      const output = { ...(outcome.output ?? {}) };
      if (step.output?.['reconciliation'] !== undefined && output['reconciliation'] === undefined) {
        output['reconciliation'] = step.output['reconciliation'];
      }
      await this.deps.store.updateStep(run.tenantId, step.id, {
        status: 'completed',
        output,
        finishedAt: this.now(),
        error: null,
      });
    }
    if (!(await this.keepLease(run.tenantId, run.id, workerId))) return 'deferred';
    const artifacts = await this.deps.store.listArtifacts(run.tenantId, run.id);
    await this.finish(run.tenantId, run, 'completed', null, `${artifacts.length} arquivo(s) gerado(s).`);
    return 'done';
  }

  private async executeStep(
    run: RunRow,
    version: VersionRow,
    step: StepRow,
    definition: AutomationStepDefinition,
    signal: AbortSignal,
    workerId: string,
  ): Promise<StepOutcome> {
    if (definition.kind === 'browser_workflow') return this.executeBrowser(run, version, step, definition, signal, workerId);
    if (definition.kind === 'validate_reports') return this.executeValidate(run);
    if (definition.kind === 'send_email') return this.executeSend(run, version, step);
    return { type: 'failed', error: `Etapa desconhecida: ${definition.kind}.`, retryable: false };
  }

  private async executeBrowser(
    run: RunRow,
    version: VersionRow,
    step: StepRow,
    definition: AutomationStepDefinition,
    signal: AbortSignal,
    workerId: string,
  ): Promise<StepOutcome> {
    if (!definition.connectionId || !definition.workflowKey || !definition.workflowVersion || !definition.revisionId) {
      return { type: 'failed', error: 'Workflow de navegador sem revisão fixada.', retryable: false };
    }
    assertConnectionAllowed(version.authorizationPolicy, definition.connectionId);
    const result = await this.deps.browser.execute({
      tenantId: run.tenantId,
      runId: run.id,
      connectionId: definition.connectionId,
      workflowKey: definition.workflowKey,
      workflowVersion: definition.workflowVersion,
      revisionId: definition.revisionId,
      parameters: run.params,
      signal,
    });
    if (!(await this.keepLease(run.tenantId, run.id, workerId))) return { type: 'deferred' };
    for (const file of result.files) {
      if (!(await this.keepLease(run.tenantId, run.id, workerId))) return { type: 'deferred' };
      const id = createId();
      const stored = await this.deps.storage.put({
        tenantId: run.tenantId,
        id,
        body: file.body,
        contentType: file.mime,
      });
      await this.deps.store.insertArtifact({
        id,
        tenantId: run.tenantId,
        runId: run.id,
        stepRunId: step.id,
        name: file.name,
        mime: file.mime,
        storageKey: stored.key,
        byteSize: file.body.length,
        checksum: checksumBuffer(file.body),
        createdAt: this.now(),
      });
    }
    if (!(await this.keepLease(run.tenantId, run.id, workerId))) return { type: 'deferred' };
    if (result.externalExecutionId) {
      await this.deps.store.updateStep(run.tenantId, step.id, { externalExecutionId: result.externalExecutionId });
    }
    if (result.status === 'cancelled') return { type: 'failed', error: result.message ?? 'Exportação cancelada.', retryable: false };
    if (result.status === 'needs_attention') {
      return { type: 'needs_attention', error: result.message ?? 'A exportação requer atenção.' };
    }
    if (result.status === 'partial') {
      return { type: 'failed', error: result.message ?? 'Exportação incompleta. O envio foi bloqueado.', retryable: false };
    }
    if (result.status === 'failed') {
      return { type: 'failed', error: result.message ?? 'Falha ao exportar os relatórios.', retryable: result.retryable };
    }
    return { type: 'completed', output: { files: result.files.length } };
  }

  private async executeValidate(run: RunRow): Promise<StepOutcome> {
    const artifacts = await this.deps.store.listArtifacts(run.tenantId, run.id);
    const files = [];
    for (const artifact of artifacts) {
      const object = await this.deps.storage.get(artifact.storageKey);
      files.push({ name: artifact.name, mime: artifact.mime, body: object.body });
    }
    const reports = Array.isArray(run.params['reports']) ? (run.params['reports'] as string[]) : [];
    const verdict = validateReportBundle(files, {
      reports,
      periodStart: String(run.params['periodStart'] ?? ''),
      periodEnd: String(run.params['periodEnd'] ?? ''),
    });
    if (!verdict.ok) return { type: 'failed', error: verdict.reason, retryable: false };
    return { type: 'completed', output: { reports } };
  }

  private async executeSend(run: RunRow, version: VersionRow, step: StepRow): Promise<StepOutcome> {
    const recipient = String(run.params['recipient'] ?? '');
    const effect = decideEmailEffect(version.authorizationPolicy, recipient, run.forceApproval);
    if (effect === 'reject') {
      return { type: 'failed', error: 'Destinatário fora do escopo autorizado desta automação.', retryable: false };
    }
    if (version.authorizationPolicy.requireRealTransport) {
      const driver = (await this.deps.emailDriver?.(run.tenantId)) ?? 'console';
      if (driver === 'console' || driver === 'memory') {
        return { type: 'failed', error: 'Transporte de e-mail real não configurado.', retryable: false };
      }
    }
    const artifacts = await this.deps.store.listArtifacts(run.tenantId, run.id);
    const reports = Array.isArray(run.params['reports']) ? (run.params['reports'] as string[]).join(', ') : '';
    const subject = typeof run.params['subject'] === 'string' ? run.params['subject'] : `Relatórios ${String(run.params['periodStart'] ?? '')} a ${String(run.params['periodEnd'] ?? '')}`;
    const body = typeof run.params['body'] === 'string' ? run.params['body'] : `Seguem os relatórios solicitados: ${reports}.`;
    const email = {
      to: recipient,
      subject,
      body,
      artifactIds: artifacts.map((artifact) => artifact.id),
    };
    let proposal;
    try {
      proposal = await this.deps.effects.propose({
        ctx: this.effectContext(run),
        idempotencyKey: `automation:${run.id}:send:${sendGeneration(step)}`,
        forceExecute: effect === 'allow',
        origin: run.origin === 'schedule' || run.origin === 'webhook' || run.origin === 'internal_event' ? 'schedule' : 'user',
        reason: effect === 'approve' ? 'Destinatário ou modo de efeito exige aprovação.' : 'Envio autorizado pela política da automação.',
        email,
      });
    } catch (error) {
      if (isUncertainEmailError(error)) {
        return { type: 'needs_attention', error: error instanceof Error ? error.message : 'Envio incerto.' };
      }
      return { type: 'failed', error: error instanceof Error ? error.message : 'Falha ao enviar.', retryable: false };
    }
    if (proposal.status === 'needs_attention' || isUncertainEmailError(new Error(proposal.error ?? ''))) {
      return { type: 'needs_attention', error: proposal.error ?? 'Envio com resultado incerto.' };
    }
    if (proposal.status === 'awaiting_approval' || isOpenEffect(proposal.status)) {
      return {
        type: proposal.status === 'awaiting_approval' ? 'awaiting_approval' : 'effect_pending',
        actionExecutionId: proposal.actionExecutionId,
        approvalId: proposal.approvalId,
        output: { ...email, sendGeneration: sendGeneration(step) },
      };
    }
    if (proposal.status === 'failed') {
      return { type: 'failed', error: proposal.error ?? 'O envio falhou.', retryable: false };
    }
    return { type: 'completed', output: { ...(proposal.output ?? {}), to: recipient, sendGeneration: sendGeneration(step) } };
  }

  private effectContext(run: RunRow): RequestContext {
    return {
      requestId: `automation:${run.id}`,
      tenantId: run.tenantId,
      userId: run.requestedBy,
      operatorId: null,
      role: 'owner',
      ip: null,
    };
  }

  private systemContext(tenantId: string): RequestContext {
    return {
      requestId: createId(),
      tenantId,
      userId: null,
      operatorId: null,
      role: 'owner',
      ip: null,
    };
  }

  private async applySettlement(run: RunRow, step: StepRow): Promise<'continue' | 'wait' | 'effect_pending' | 'stop'> {
    if (!step.actionExecutionId) return 'wait';
    const proposal = await this.deps.effects.lookup(run.tenantId, step.actionExecutionId);
    if (!proposal || proposal.status === 'awaiting_approval') return 'wait';
    if (isOpenEffect(proposal.status)) return 'effect_pending';
    if (proposal.status === 'needs_attention') {
      await this.markAttention(run, step, proposal.error ?? 'Envio com resultado incerto.');
      return 'stop';
    }
    if (proposal.status === 'failed') {
      await this.deps.store.updateStep(run.tenantId, step.id, {
        status: 'failed',
        error: proposal.error ?? 'Efeito rejeitado ou falhou.',
        finishedAt: this.now(),
      });
      await this.fail(run, proposal.error ?? 'Efeito rejeitado ou falhou.');
      return 'stop';
    }
    await this.deps.store.updateStep(run.tenantId, step.id, {
      status: 'completed',
      output: proposal.output ?? {},
      finishedAt: this.now(),
    });
    return 'continue';
  }

  private async settleEffect(tenantId: string, actionExecutionId: string) {
    const step = await this.deps.store.findStepByExecution(tenantId, actionExecutionId);
    if (!step?.actionExecutionId) return;
    if (step.status !== 'awaiting_approval' && step.status !== 'running') return;
    const run = await this.deps.store.findRun(tenantId, step.runId);
    if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'needs_attention') {
      return;
    }
    const settled = await this.applySettlement(run, step);
    if (settled === 'effect_pending') {
      await this.parkEffect(run, step);
      return;
    }
    if (settled === 'continue') {
      await this.deps.store.requeueRun(tenantId, run.id, this.now());
      await this.dispatch();
    }
  }

  private async reconcileSettledEffects(tenantId: string, runId: string) {
    const steps = await this.deps.store.listSteps(tenantId, runId);
    for (const step of steps) {
      if (step.actionExecutionId && (step.status === 'awaiting_approval' || step.status === 'running')) {
        await this.settleEffect(tenantId, step.actionExecutionId);
      }
    }
  }

  private async parkEffect(run: RunRow, step: StepRow) {
    await this.deps.store.updateStep(run.tenantId, step.id, {
      status: 'running',
      actionExecutionId: step.actionExecutionId,
      approvalId: step.approvalId,
    });
    await this.deps.store.updateRun(run.tenantId, run.id, {
      status: 'running',
      error: null,
      leaseOwner: null,
      leaseUntil: null,
    });
  }

  private async keepLease(tenantId: string, runId: string, workerId: string): Promise<boolean> {
    return this.deps.store.renewLease(
      tenantId,
      runId,
      workerId,
      new Date(this.now().getTime() + this.leaseMs),
      this.now(),
    );
  }

  private async releaseLease(run: RunRow) {
    await this.deps.store.updateRun(run.tenantId, run.id, { leaseOwner: null, leaseUntil: null });
  }

  private async markAttention(run: RunRow, step: StepRow, error: string) {
    await this.deps.store.updateStep(run.tenantId, step.id, {
      status: 'needs_attention',
      error,
      finishedAt: this.now(),
      reconciled: false,
    });
    await this.park(run, 'needs_attention', error);
  }

  private async park(run: RunRow, status: 'awaiting_approval' | 'needs_attention', error: string | null) {
    await this.deps.store.updateRun(run.tenantId, run.id, {
      status,
      error,
      leaseOwner: null,
      leaseUntil: null,
    });
    if (run.scheduleOccurrenceId) {
      await this.deps.schedules?.onRunSettled({
        tenantId: run.tenantId,
        occurrenceId: run.scheduleOccurrenceId,
        runId: run.id,
        status,
        summary: null,
      });
    }
  }

  private async fail(run: RunRow, error: string) {
    await this.finish(run.tenantId, run, 'failed', error);
  }

  private async finish(
    tenantId: string,
    run: RunRow,
    status: 'completed' | 'failed' | 'cancelled',
    error: string | null,
    summary?: string | null,
  ) {
    const steps = await this.deps.store.listSteps(tenantId, run.id);
    for (const step of steps) {
      if (step.status === 'pending' || step.status === 'running') {
        await this.deps.store.updateStep(tenantId, step.id, {
          status: status === 'cancelled' ? 'cancelled' : 'skipped',
          finishedAt: this.now(),
        });
      }
    }
    await this.deps.store.updateRun(tenantId, run.id, {
      status,
      error,
      summary: summary ?? run.summary,
      finishedAt: this.now(),
      leaseOwner: null,
      leaseUntil: null,
    });
    if (run.scheduleOccurrenceId) {
      await this.deps.schedules?.onRunSettled({
        tenantId,
        occurrenceId: run.scheduleOccurrenceId,
        runId: run.id,
        status,
        summary: summary ?? null,
      });
    }
  }

  private async pinSteps(tenantId: string, steps: AutomationStepDefinition[]): Promise<AutomationStepDefinition[]> {
    const pinned: AutomationStepDefinition[] = [];
    for (const step of steps) {
      if (step.kind !== 'browser_workflow') {
        pinned.push(step);
        continue;
      }
      const revisionId =
        step.revisionId ??
        (step.workflowKey && step.workflowVersion
          ? ((await this.deps.revisions?.pin(tenantId, step.workflowKey, step.workflowVersion)) ?? undefined)
          : undefined);
      if (!revisionId) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Publique o workflow de navegador antes de publicar a automação.',
        );
      }
      pinned.push({ ...step, revisionId });
    }
    return pinned;
  }

  private sameOrConflict(existing: RunRow, contentHash: string) {
    if (existing.contentHash !== contentHash) {
      throw new AppError(ErrorCode.CONFLICT, 'Este identificador de disparo já foi usado com outro conteúdo.');
    }
    return this.view(existing);
  }

  private async requireAutomation(tenantId: string, id: string) {
    const automation = await this.deps.store.findAutomation(tenantId, id);
    if (!automation) throw new AppError(ErrorCode.NOT_FOUND, 'Automação não encontrada.');
    return automation;
  }

  private async requireVersion(tenantId: string, id: string) {
    const version = await this.deps.store.findVersion(tenantId, id);
    if (!version) throw new AppError(ErrorCode.NOT_FOUND, 'Versão não encontrada.');
    return version;
  }

  private async requireRun(tenantId: string, id: string) {
    const run = await this.deps.store.findRun(tenantId, id);
    if (!run) throw new AppError(ErrorCode.NOT_FOUND, 'Execução não encontrada.');
    return run;
  }

  private async requireOwnedRun(ctx: RequestContext, automationId: string, runId: string) {
    assertTenantContext(ctx);
    const run = await this.requireRun(ctx.tenantId, runId);
    if (run.automationId !== automationId) throw new AppError(ErrorCode.NOT_FOUND, 'Execução não encontrada.');
    const admin = Boolean(ctx.operatorId) || hasMinRole(ctx.role, 'admin');
    if (!admin && run.requestedBy !== ctx.userId) {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Você só pode alterar as próprias execuções.');
    }
    return run;
  }

  private async view(run: RunRow) {
    const steps = await this.deps.store.listSteps(run.tenantId, run.id);
    const artifacts = await this.deps.store.listArtifacts(run.tenantId, run.id);
    return {
      id: run.id,
      automationId: run.automationId,
      versionId: run.versionId,
      status: run.status,
      origin: run.origin,
      originRef: run.originRef,
      url: `/automations/${run.automationId}/runs/${run.id}`,
      summary: run.summary,
      error: run.error,
      params: run.params,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      steps: steps.map((step) => ({
        id: step.id,
        key: step.stepKey,
        status: step.status,
        attempt: step.attempt,
        error: step.error,
        approvalId: step.approvalId,
        reconciliation: reconciliationOf(step.output),
      })),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        name: artifact.name,
        mime: artifact.mime,
        byteSize: artifact.byteSize,
      })),
    };
  }
}
