import { Prisma, type PrismaClient } from '@tactia/database';
import type {
  ArtifactRow,
  AutomationRow,
  AutomationStore,
  DomainEventRow,
  OutboxRow,
  OutboxStatusName,
  RunRow,
  ScheduleLink,
  StepRow,
  TriggerRow,
  VersionRow,
} from './records';
import type {
  AuthorizationPolicy,
  AutomationInputSchema,
  AutomationStepDefinition,
  PageConfig,
} from '@tactia/domain';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isUnique(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

export class PrismaAutomationStore implements AutomationStore {
  constructor(private readonly db: PrismaClient) {}

  async isEnabled(tenantId: string): Promise<boolean> {
    const tenant = await this.db.tenant.findFirst({ where: { id: tenantId }, select: { automationsEnabled: true } });
    return tenant?.automationsEnabled === true;
  }

  async setEnabled(tenantId: string, enabled: boolean): Promise<void> {
    await this.db.tenant.update({ where: { id: tenantId }, data: { automationsEnabled: enabled } });
  }

  async tenantTimezone(tenantId: string): Promise<string> {
    const tenant = await this.db.tenant.findFirst({ where: { id: tenantId }, select: { timezone: true } });
    return tenant?.timezone || 'America/Sao_Paulo';
  }

  async insertAutomation(row: AutomationRow): Promise<void> {
    await this.db.automation.create({
      data: {
        id: row.id,
        tenantId: row.tenantId,
        key: row.key,
        name: row.name,
        purpose: row.purpose,
        status: row.status,
        publishedVersionId: row.publishedVersionId,
        componentKey: row.componentKey,
        parameterDefaults: json(row.parameterDefaults),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    });
  }

  async updateAutomation(tenantId: string, id: string, patch: Partial<AutomationRow>): Promise<AutomationRow | null> {
    const current = await this.findAutomation(tenantId, id);
    if (!current) return null;
    const updated = await this.db.automation.update({
      where: { id },
      data: {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.purpose === undefined ? {} : { purpose: patch.purpose }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.publishedVersionId === undefined ? {} : { publishedVersionId: patch.publishedVersionId }),
        ...(patch.componentKey === undefined ? {} : { componentKey: patch.componentKey }),
        ...(patch.parameterDefaults === undefined ? {} : { parameterDefaults: json(patch.parameterDefaults) }),
      },
    });
    return this.automationRow(updated);
  }

  async findAutomation(tenantId: string, id: string): Promise<AutomationRow | null> {
    const row = await this.db.automation.findFirst({ where: { id, tenantId } });
    return row ? this.automationRow(row) : null;
  }

  async listAutomations(tenantId: string): Promise<AutomationRow[]> {
    const rows = await this.db.automation.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => this.automationRow(row));
  }

  async insertVersion(row: VersionRow): Promise<void> {
    await this.db.automationVersion.create({ data: this.versionData(row) });
  }

  async saveVersion(row: VersionRow): Promise<void> {
    await this.db.automationVersion.update({
      where: { id: row.id },
      data: {
        steps: json(row.steps),
        inputSchema: json(row.inputSchema),
        outputSchema: json(row.outputSchema),
        pageConfig: json(row.pageConfig),
        authorizationPolicy: json(row.authorizationPolicy),
        publishedAt: row.publishedAt,
      },
    });
  }

  async findVersion(tenantId: string, id: string): Promise<VersionRow | null> {
    const row = await this.db.automationVersion.findFirst({ where: { id, tenantId } });
    return row ? this.versionRow(row) : null;
  }

  async findLatestVersion(tenantId: string, automationId: string): Promise<VersionRow | null> {
    const row = await this.db.automationVersion.findFirst({
      where: { tenantId, automationId },
      orderBy: { version: 'desc' },
    });
    return row ? this.versionRow(row) : null;
  }

  async latestVersionNumber(automationId: string): Promise<number> {
    const row = await this.db.automationVersion.findFirst({
      where: { automationId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return row?.version ?? 0;
  }

  async insertRunBundle(input: { run: RunRow; steps: StepRow[]; outbox: OutboxRow }): Promise<'created' | 'duplicate'> {
    try {
      await this.db.$transaction(async (tx) => {
        await tx.automationRun.create({ data: this.runData(input.run) });
        await tx.automationStepRun.createMany({ data: input.steps.map((step) => this.stepData(step)) });
        await tx.automationOutbox.create({
          data: {
            id: input.outbox.id,
            tenantId: input.outbox.tenantId,
            runId: input.outbox.runId,
            status: input.outbox.status,
            availableAt: input.outbox.availableAt,
            publishedAt: input.outbox.publishedAt,
            updatedAt: input.outbox.updatedAt,
            createdAt: input.outbox.updatedAt,
          },
        });
      });
      return 'created';
    } catch (error) {
      if (isUnique(error)) return 'duplicate';
      throw error;
    }
  }

  async findRunByIdempotency(tenantId: string, automationId: string, key: string): Promise<RunRow | null> {
    const row = await this.db.automationRun.findFirst({ where: { tenantId, automationId, idempotencyKey: key } });
    return row ? this.runRow(row) : null;
  }

  async findRun(tenantId: string, id: string): Promise<RunRow | null> {
    const row = await this.db.automationRun.findFirst({ where: { id, tenantId } });
    return row ? this.runRow(row) : null;
  }

  async listRuns(tenantId: string, automationId: string, limit: number): Promise<RunRow[]> {
    const rows = await this.db.automationRun.findMany({
      where: { tenantId, automationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => this.runRow(row));
  }

  async latestRun(tenantId: string, automationId: string): Promise<RunRow | null> {
    const [first] = await this.listRuns(tenantId, automationId, 1);
    return first ?? null;
  }

  async claimRun(tenantId: string, id: string, workerId: string, leaseUntil: Date, _now: Date): Promise<RunRow | null> {
    const rows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE automation_runs
      SET status = 'running'::"AutomationRunStatus",
          lease_owner = ${workerId},
          lease_until = ${leaseUntil},
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW()
      WHERE id = ${id}::uuid
        AND tenant_id = ${tenantId}::uuid
        AND (
          status = 'queued'::"AutomationRunStatus"
          OR (
            status = 'running'::"AutomationRunStatus"
            AND lease_until IS NOT NULL
            AND lease_until <= NOW()
          )
        )
      RETURNING id
    `;
    if (!rows[0]) return null;
    return this.findRun(tenantId, id);
  }

  async renewLease(tenantId: string, id: string, workerId: string, leaseUntil: Date, _now: Date): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE automation_runs
      SET lease_until = ${leaseUntil},
          updated_at = NOW()
      WHERE id = ${id}::uuid
        AND tenant_id = ${tenantId}::uuid
        AND lease_owner = ${workerId}
        AND status = 'running'::"AutomationRunStatus"
        AND lease_until IS NOT NULL
        AND lease_until > NOW()
      RETURNING id
    `;
    return Boolean(rows[0]);
  }

  async updateRun(tenantId: string, id: string, patch: Partial<RunRow>): Promise<void> {
    await this.db.automationRun.updateMany({
      where: { id, tenantId },
      data: {
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.summary === undefined ? {} : { summary: patch.summary }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
        ...(patch.cancelRequested === undefined ? {} : { cancelRequested: patch.cancelRequested }),
        ...(patch.leaseOwner === undefined ? {} : { leaseOwner: patch.leaseOwner }),
        ...(patch.leaseUntil === undefined ? {} : { leaseUntil: patch.leaseUntil }),
        ...(patch.startedAt === undefined ? {} : { startedAt: patch.startedAt }),
        ...(patch.finishedAt === undefined ? {} : { finishedAt: patch.finishedAt }),
      },
    });
  }

  async countRuns(): Promise<Record<string, number>> {
    const groups = await this.db.automationRun.groupBy({ by: ['status'], _count: { _all: true } });
    const counts: Record<string, number> = {};
    for (const group of groups) counts[group.status] = group._count._all;
    return counts;
  }

  async listSteps(tenantId: string, runId: string): Promise<StepRow[]> {
    const rows = await this.db.automationStepRun.findMany({
      where: { tenantId, runId },
      orderBy: { ordinal: 'asc' },
    });
    return rows.map((row) => this.stepRow(row));
  }

  async updateStep(tenantId: string, id: string, patch: Partial<StepRow>): Promise<void> {
    await this.db.automationStepRun.updateMany({
      where: { id, tenantId },
      data: {
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.attempt === undefined ? {} : { attempt: patch.attempt }),
        ...(patch.input === undefined ? {} : { input: json(patch.input) }),
        ...(patch.output === undefined ? {} : { output: patch.output === null ? Prisma.JsonNull : json(patch.output) }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
        ...(patch.reconciled === undefined ? {} : { reconciled: patch.reconciled }),
        ...(patch.actionExecutionId === undefined ? {} : { actionExecutionId: patch.actionExecutionId }),
        ...(patch.approvalId === undefined ? {} : { approvalId: patch.approvalId }),
        ...(patch.externalExecutionId === undefined ? {} : { externalExecutionId: patch.externalExecutionId }),
        ...(patch.startedAt === undefined ? {} : { startedAt: patch.startedAt }),
        ...(patch.finishedAt === undefined ? {} : { finishedAt: patch.finishedAt }),
      },
    });
  }

  async findStepByExecution(tenantId: string, actionExecutionId: string): Promise<StepRow | null> {
    const row = await this.db.automationStepRun.findFirst({ where: { tenantId, actionExecutionId } });
    return row ? this.stepRow(row) : null;
  }

  async insertArtifact(row: ArtifactRow): Promise<void> {
    await this.db.automationArtifact.create({
      data: {
        id: row.id,
        tenantId: row.tenantId,
        runId: row.runId,
        stepRunId: row.stepRunId,
        name: row.name,
        mime: row.mime,
        storageKey: row.storageKey,
        byteSize: row.byteSize,
        checksum: row.checksum,
        createdAt: row.createdAt,
      },
    });
  }

  async listArtifacts(tenantId: string, runId: string): Promise<ArtifactRow[]> {
    const rows = await this.db.automationArtifact.findMany({ where: { tenantId, runId }, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => this.artifactRow(row));
  }

  async findArtifact(tenantId: string, id: string): Promise<ArtifactRow | null> {
    const row = await this.db.automationArtifact.findFirst({ where: { id, tenantId } });
    return row ? this.artifactRow(row) : null;
  }

  async claimOutbox(now: Date, limit: number): Promise<OutboxRow[]> {
    const ready = await this.db.automationOutbox.findMany({
      where: { status: 'pending', availableAt: { lte: now } },
      orderBy: { availableAt: 'asc' },
      take: limit,
    });
    const claimed: OutboxRow[] = [];
    for (const row of ready) {
      const updated = await this.db.automationOutbox.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'dispatching' },
      });
      if (updated.count === 1) claimed.push(this.outboxRow({ ...row, status: 'dispatching' }));
    }
    return claimed;
  }

  async markOutbox(id: string, status: OutboxStatusName, now: Date): Promise<void> {
    await this.db.automationOutbox.update({
      where: { id },
      data: { status, ...(status === 'dispatched' ? { publishedAt: now } : {}) },
    });
  }

  async requeueRun(tenantId: string, runId: string, availableAt: Date): Promise<void> {
    await this.db.automationRun.updateMany({
      where: { id: runId, tenantId },
      data: { status: 'queued', leaseOwner: null, leaseUntil: null },
    });
    await this.db.automationOutbox.updateMany({
      where: { runId, tenantId },
      data: { status: 'pending', availableAt, publishedAt: null },
    });
  }

  async recover(now: Date): Promise<number> {
    const expired = await this.db.automationRun.updateMany({
      where: { status: 'running', leaseUntil: { lte: now } },
      data: { status: 'queued', leaseOwner: null, leaseUntil: null },
    });
    const staleDispatch = new Date(now.getTime() - 60_000);
    const dispatching = await this.db.automationOutbox.updateMany({
      where: { status: 'dispatching', updatedAt: { lte: staleDispatch } },
      data: { status: 'pending', availableAt: now },
    });
    const republish = await this.db.automationOutbox.updateMany({
      where: { status: 'dispatched', run: { status: 'queued' } },
      data: { status: 'pending', availableAt: now, publishedAt: null },
    });
    return expired.count + dispatching.count + republish.count;
  }

  async tryAcquireLock(connectionId: string, tenantId: string, runId: string, now: Date, ttlMs: number): Promise<boolean> {
    const expiry = new Date(now.getTime() - ttlMs);
    await this.db.automationConnectionLock.deleteMany({
      where: { connectionId, acquiredAt: { lt: expiry }, NOT: { runId } },
    });
    try {
      await this.db.automationConnectionLock.create({
        data: { connectionId, tenantId, runId, acquiredAt: now },
      });
      return true;
    } catch (error) {
      if (!isUnique(error)) throw error;
      const current = await this.db.automationConnectionLock.findUnique({ where: { connectionId } });
      return current?.runId === runId;
    }
  }

  async renewLock(connectionId: string, runId: string, now: Date): Promise<boolean> {
    const updated = await this.db.automationConnectionLock.updateMany({
      where: { connectionId, runId },
      data: { acquiredAt: now },
    });
    return updated.count === 1;
  }

  async releaseLock(connectionId: string, runId: string): Promise<void> {
    await this.db.automationConnectionLock.deleteMany({ where: { connectionId, runId } });
  }

  async insertTrigger(row: TriggerRow): Promise<void> {
    await this.db.automationTrigger.create({
      data: {
        id: row.id,
        tenantId: row.tenantId,
        automationId: row.automationId,
        kind: row.kind,
        enabled: row.enabled,
        secretCipher: row.secretCipher,
        eventType: row.eventType,
        connectionId: row.connectionId,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      },
    });
  }

  async updateTrigger(tenantId: string, id: string, patch: Partial<TriggerRow>): Promise<TriggerRow | null> {
    const current = await this.findTrigger(id);
    if (!current || current.tenantId !== tenantId) return null;
    const updated = await this.db.automationTrigger.update({
      where: { id },
      data: { ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }) },
    });
    return this.triggerRow(updated);
  }

  async findTrigger(id: string): Promise<TriggerRow | null> {
    const row = await this.db.automationTrigger.findUnique({ where: { id } });
    return row ? this.triggerRow(row) : null;
  }

  async listTriggers(tenantId: string, automationId: string): Promise<TriggerRow[]> {
    const rows = await this.db.automationTrigger.findMany({ where: { tenantId, automationId } });
    return rows.map((row) => this.triggerRow(row));
  }

  async listEventTriggers(eventType: string, connectionId: string): Promise<TriggerRow[]> {
    const rows = await this.db.automationTrigger.findMany({
      where: { kind: 'internal_event', enabled: true, eventType, connectionId },
    });
    return rows.map((row) => this.triggerRow(row));
  }

  async insertDomainEvent(row: DomainEventRow): Promise<DomainEventRow> {
    try {
      const created = await this.db.domainEvent.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          type: row.type,
          sourceId: row.sourceId,
          connectionId: row.connectionId,
          createdAt: row.createdAt,
        },
      });
      return this.eventRow(created);
    } catch (error) {
      if (!isUnique(error)) throw error;
      const existing = await this.db.domainEvent.findFirst({
        where: { tenantId: row.tenantId, type: row.type, sourceId: row.sourceId },
      });
      if (!existing) throw error;
      return this.eventRow(existing);
    }
  }

  async listPendingDomainEvents(limit: number): Promise<DomainEventRow[]> {
    const rows = await this.db.domainEvent.findMany({
      where: { dispatchedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.eventRow(row));
  }

  async markDomainEventDispatched(id: string, at: Date): Promise<void> {
    await this.db.domainEvent.update({ where: { id }, data: { dispatchedAt: at } });
  }

  async listSchedules(tenantId: string, automationId: string): Promise<ScheduleLink[]> {
    const rows = await this.db.schedule.findMany({ where: { tenantId, automationId } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      frequency: row.frequency,
      timezone: row.timezone,
      recurrenceConfig: record(row.recurrenceConfig) as ScheduleLink['recurrenceConfig'],
      lastRunAt: row.lastRunAt,
    }));
  }

  private automationRow(row: {
    id: string;
    tenantId: string;
    key: string;
    name: string;
    purpose: string;
    status: AutomationRow['status'];
    publishedVersionId: string | null;
    componentKey: string | null;
    parameterDefaults: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): AutomationRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      key: row.key,
      name: row.name,
      purpose: row.purpose,
      status: row.status,
      publishedVersionId: row.publishedVersionId,
      componentKey: row.componentKey,
      parameterDefaults: record(row.parameterDefaults),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private versionData(row: VersionRow): Prisma.AutomationVersionCreateInput {
    return {
      id: row.id,
      version: row.version,
      inputSchema: json(row.inputSchema),
      outputSchema: json(row.outputSchema),
      steps: json(row.steps),
      pageConfig: json(row.pageConfig),
      authorizationPolicy: json(row.authorizationPolicy),
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      tenant: { connect: { id: row.tenantId } },
      automation: { connect: { id: row.automationId } },
    };
  }

  private versionRow(row: {
    id: string;
    tenantId: string;
    automationId: string;
    version: number;
    inputSchema: unknown;
    outputSchema: unknown;
    steps: unknown;
    pageConfig: unknown;
    authorizationPolicy: unknown;
    publishedAt: Date | null;
    createdAt: Date;
  }): VersionRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      automationId: row.automationId,
      version: row.version,
      inputSchema: row.inputSchema as AutomationInputSchema,
      outputSchema: record(row.outputSchema),
      steps: (Array.isArray(row.steps) ? row.steps : []) as AutomationStepDefinition[],
      pageConfig: row.pageConfig as PageConfig,
      authorizationPolicy: row.authorizationPolicy as AuthorizationPolicy,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
    };
  }

  private runData(row: RunRow): Prisma.AutomationRunCreateInput {
    return {
      id: row.id,
      status: row.status,
      origin: row.origin,
      originRef: row.originRef,
      idempotencyKey: row.idempotencyKey,
      contentHash: row.contentHash,
      params: json(row.params),
      summary: row.summary,
      error: row.error,
      requestedBy: row.requestedBy,
      scheduleOccurrenceId: row.scheduleOccurrenceId,
      cancelRequested: row.cancelRequested,
      forceApproval: row.forceApproval,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tenant: { connect: { id: row.tenantId } },
      automation: { connect: { id: row.automationId } },
      version: { connect: { id: row.versionId } },
    };
  }

  private runRow(row: {
    id: string;
    tenantId: string;
    automationId: string;
    versionId: string;
    status: RunRow['status'];
    origin: RunRow['origin'];
    originRef: string | null;
    idempotencyKey: string;
    contentHash: string;
    params: unknown;
    summary: string | null;
    error: string | null;
    requestedBy: string | null;
    scheduleOccurrenceId: string | null;
    cancelRequested: boolean;
    forceApproval: boolean;
    leaseOwner: string | null;
    leaseUntil: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): RunRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      automationId: row.automationId,
      versionId: row.versionId,
      status: row.status,
      origin: row.origin,
      originRef: row.originRef,
      idempotencyKey: row.idempotencyKey,
      contentHash: row.contentHash,
      params: record(row.params),
      summary: row.summary,
      error: row.error,
      requestedBy: row.requestedBy,
      scheduleOccurrenceId: row.scheduleOccurrenceId,
      cancelRequested: row.cancelRequested,
      forceApproval: row.forceApproval,
      leaseOwner: row.leaseOwner,
      leaseUntil: row.leaseUntil,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private stepData(row: StepRow): Prisma.AutomationStepRunCreateManyInput {
    return {
      id: row.id,
      tenantId: row.tenantId,
      runId: row.runId,
      stepKey: row.stepKey,
      ordinal: row.ordinal,
      status: row.status,
      attempt: row.attempt,
      input: json(row.input),
      retryable: row.retryable,
      reconciled: row.reconciled,
    };
  }

  private stepRow(row: {
    id: string;
    tenantId: string;
    runId: string;
    stepKey: string;
    ordinal: number;
    status: StepRow['status'];
    attempt: number;
    input: unknown;
    output: unknown;
    error: string | null;
    retryable: boolean;
    reconciled: boolean;
    actionExecutionId: string | null;
    approvalId: string | null;
    externalExecutionId: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }): StepRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      runId: row.runId,
      stepKey: row.stepKey,
      ordinal: row.ordinal,
      status: row.status,
      attempt: row.attempt,
      input: record(row.input),
      output: row.output === null ? null : record(row.output),
      error: row.error,
      retryable: row.retryable,
      reconciled: row.reconciled,
      actionExecutionId: row.actionExecutionId,
      approvalId: row.approvalId,
      externalExecutionId: row.externalExecutionId,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    };
  }

  private artifactRow(row: ArtifactRow): ArtifactRow {
    return { ...row };
  }

  private outboxRow(row: {
    id: string;
    tenantId: string;
    runId: string;
    status: OutboxStatusName;
    availableAt: Date;
    publishedAt: Date | null;
    updatedAt: Date;
  }): OutboxRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      runId: row.runId,
      status: row.status,
      availableAt: row.availableAt,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
    };
  }

  private triggerRow(row: {
    id: string;
    tenantId: string;
    automationId: string;
    kind: TriggerRow['kind'];
    enabled: boolean;
    secretCipher: string | null;
    eventType: string | null;
    connectionId: string | null;
    createdAt: Date;
  }): TriggerRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      automationId: row.automationId,
      kind: row.kind,
      enabled: row.enabled,
      secretCipher: row.secretCipher,
      eventType: row.eventType,
      connectionId: row.connectionId,
      createdAt: row.createdAt,
    };
  }

  private eventRow(row: DomainEventRow): DomainEventRow {
    return { ...row };
  }
}
