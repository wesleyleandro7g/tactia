import { createId } from '@tactia/shared';
import type {
  ArtifactRow,
  AutomationRow,
  AutomationStore,
  DomainEventRow,
  OutboxRow,
  RunRow,
  ScheduleLink,
  StepRow,
  TriggerRow,
  VersionRow,
} from './records';

function copy<T>(value: T): T {
  return structuredClone(value);
}

/** Store em memória com a mesma semântica da persistência (testes e recuperação). */
export class MemoryAutomationStore implements AutomationStore {
  private readonly enabled = new Map<string, boolean>();
  private readonly timezones = new Map<string, string>();
  private readonly automations = new Map<string, AutomationRow>();
  private readonly versions = new Map<string, VersionRow>();
  private readonly runs = new Map<string, RunRow>();
  private readonly steps = new Map<string, StepRow>();
  private readonly artifacts = new Map<string, ArtifactRow>();
  private readonly outbox = new Map<string, OutboxRow>();
  private readonly locks = new Map<string, { tenantId: string; runId: string; acquiredAt: Date }>();
  private readonly triggers = new Map<string, TriggerRow>();
  private readonly events = new Map<string, DomainEventRow>();
  private readonly schedules: ScheduleLink[] = [];
  private readonly scheduleTenant = new Map<string, string>();

  constructor(private readonly tenants: string[] = []) {
    for (const tenantId of tenants) this.enabled.set(tenantId, true);
  }

  async isEnabled(tenantId: string): Promise<boolean> {
    return this.enabled.get(tenantId) === true;
  }

  async setEnabled(tenantId: string, enabled: boolean): Promise<void> {
    this.enabled.set(tenantId, enabled);
  }

  async tenantTimezone(tenantId: string): Promise<string> {
    return this.timezones.get(tenantId) ?? 'America/Sao_Paulo';
  }

  async insertAutomation(row: AutomationRow): Promise<void> {
    this.automations.set(row.id, copy(row));
  }

  async updateAutomation(tenantId: string, id: string, patch: Partial<AutomationRow>): Promise<AutomationRow | null> {
    const current = this.automations.get(id);
    if (!current || current.tenantId !== tenantId) return null;
    const next = { ...current, ...patch, id, tenantId, updatedAt: new Date() };
    this.automations.set(id, next);
    return copy(next);
  }

  async findAutomation(tenantId: string, id: string): Promise<AutomationRow | null> {
    const row = this.automations.get(id);
    return row && row.tenantId === tenantId ? copy(row) : null;
  }

  async listAutomations(tenantId: string): Promise<AutomationRow[]> {
    return [...this.automations.values()].filter((row) => row.tenantId === tenantId).map(copy);
  }

  async insertVersion(row: VersionRow): Promise<void> {
    this.versions.set(row.id, copy(row));
  }

  async saveVersion(row: VersionRow): Promise<void> {
    this.versions.set(row.id, copy(row));
  }

  async findVersion(tenantId: string, id: string): Promise<VersionRow | null> {
    const row = this.versions.get(id);
    return row && row.tenantId === tenantId ? copy(row) : null;
  }

  async findLatestVersion(tenantId: string, automationId: string): Promise<VersionRow | null> {
    let best: VersionRow | null = null;
    for (const row of this.versions.values()) {
      if (row.tenantId !== tenantId || row.automationId !== automationId) continue;
      if (!best || row.version > best.version) best = row;
    }
    return best ? copy(best) : null;
  }

  async latestVersionNumber(automationId: string): Promise<number> {
    let max = 0;
    for (const row of this.versions.values()) {
      if (row.automationId === automationId) max = Math.max(max, row.version);
    }
    return max;
  }

  async insertRunBundle(input: { run: RunRow; steps: StepRow[]; outbox: OutboxRow }): Promise<'created' | 'duplicate'> {
    const existing = await this.findRunByIdempotency(
      input.run.tenantId,
      input.run.automationId,
      input.run.idempotencyKey,
    );
    if (existing) return 'duplicate';
    this.runs.set(input.run.id, copy(input.run));
    for (const step of input.steps) this.steps.set(step.id, copy(step));
    this.outbox.set(input.outbox.id, copy(input.outbox));
    return 'created';
  }

  async findRunByIdempotency(tenantId: string, automationId: string, key: string): Promise<RunRow | null> {
    const row = [...this.runs.values()].find(
      (candidate) =>
        candidate.tenantId === tenantId &&
        candidate.automationId === automationId &&
        candidate.idempotencyKey === key,
    );
    return row ? copy(row) : null;
  }

  async findRun(tenantId: string, id: string): Promise<RunRow | null> {
    const row = this.runs.get(id);
    return row && row.tenantId === tenantId ? copy(row) : null;
  }

  async listRuns(tenantId: string, automationId: string, limit: number): Promise<RunRow[]> {
    return [...this.runs.values()]
      .filter((row) => row.tenantId === tenantId && row.automationId === automationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(copy);
  }

  async latestRun(tenantId: string, automationId: string): Promise<RunRow | null> {
    const [first] = await this.listRuns(tenantId, automationId, 1);
    return first ?? null;
  }

  async claimRun(tenantId: string, id: string, workerId: string, leaseUntil: Date, now: Date): Promise<RunRow | null> {
    const row = this.runs.get(id);
    if (!row || row.tenantId !== tenantId) return null;
    if (row.cancelRequested && row.status !== 'queued' && row.status !== 'running') return null;
    const expired = row.status === 'running' && row.leaseUntil !== null && row.leaseUntil.getTime() <= now.getTime();
    if (row.status !== 'queued' && !expired) return null;
    row.status = 'running';
    row.leaseOwner = workerId;
    row.leaseUntil = leaseUntil;
    row.startedAt = row.startedAt ?? now;
    row.updatedAt = now;
    return copy(row);
  }

  async renewLease(tenantId: string, id: string, workerId: string, leaseUntil: Date, now: Date): Promise<boolean> {
    const row = this.runs.get(id);
    if (!row || row.tenantId !== tenantId || row.leaseOwner !== workerId) return false;
    if (!row.leaseUntil || row.leaseUntil.getTime() <= now.getTime()) return false;
    row.leaseUntil = leaseUntil;
    row.updatedAt = now;
    return true;
  }

  /** Test helper: faz a posse expirar sem trocar o dono. */
  expireLease(id: string, at = new Date(0)): void {
    const row = this.runs.get(id);
    if (row) row.leaseUntil = at;
  }

  async updateRun(tenantId: string, id: string, patch: Partial<RunRow>): Promise<void> {
    const row = this.runs.get(id);
    if (!row || row.tenantId !== tenantId) return;
    Object.assign(row, patch, { id, tenantId, updatedAt: new Date() });
  }

  async countRuns(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const row of this.runs.values()) counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }

  async listSteps(tenantId: string, runId: string): Promise<StepRow[]> {
    return [...this.steps.values()]
      .filter((row) => row.tenantId === tenantId && row.runId === runId)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(copy);
  }

  async updateStep(tenantId: string, id: string, patch: Partial<StepRow>): Promise<void> {
    const row = this.steps.get(id);
    if (!row || row.tenantId !== tenantId) return;
    Object.assign(row, patch, { id, tenantId });
  }

  async findStepByExecution(tenantId: string, actionExecutionId: string): Promise<StepRow | null> {
    const row = [...this.steps.values()].find(
      (candidate) => candidate.tenantId === tenantId && candidate.actionExecutionId === actionExecutionId,
    );
    return row ? copy(row) : null;
  }

  async insertArtifact(row: ArtifactRow): Promise<void> {
    this.artifacts.set(row.id, copy(row));
  }

  async listArtifacts(tenantId: string, runId: string): Promise<ArtifactRow[]> {
    return [...this.artifacts.values()]
      .filter((row) => row.tenantId === tenantId && row.runId === runId)
      .map(copy);
  }

  async findArtifact(tenantId: string, id: string): Promise<ArtifactRow | null> {
    const row = this.artifacts.get(id);
    return row && row.tenantId === tenantId ? copy(row) : null;
  }

  async claimOutbox(now: Date, limit: number): Promise<OutboxRow[]> {
    const ready = [...this.outbox.values()]
      .filter((row) => row.status === 'pending' && row.availableAt.getTime() <= now.getTime())
      .slice(0, limit);
    for (const row of ready) {
      row.status = 'dispatching';
      row.updatedAt = now;
    }
    return ready.map(copy);
  }

  async markOutbox(id: string, status: OutboxRow['status'], now: Date): Promise<void> {
    const row = this.outbox.get(id);
    if (!row) return;
    row.status = status;
    row.updatedAt = now;
    if (status === 'dispatched') row.publishedAt = now;
  }

  async requeueRun(tenantId: string, runId: string, availableAt: Date): Promise<void> {
    const run = this.runs.get(runId);
    if (run && run.tenantId === tenantId) {
      run.status = 'queued';
      run.leaseOwner = null;
      run.leaseUntil = null;
      run.updatedAt = availableAt;
    }
    for (const row of this.outbox.values()) {
      if (row.runId === runId && row.tenantId === tenantId) {
        row.status = 'pending';
        row.availableAt = availableAt;
        row.publishedAt = null;
        row.updatedAt = availableAt;
      }
    }
  }

  async recover(now: Date): Promise<number> {
    let recovered = 0;
    for (const run of this.runs.values()) {
      const expired = run.status === 'running' && run.leaseUntil !== null && run.leaseUntil.getTime() <= now.getTime();
      if (!expired) continue;
      run.status = 'queued';
      run.leaseOwner = null;
      run.leaseUntil = null;
      run.updatedAt = now;
      await this.requeueRun(run.tenantId, run.id, now);
      recovered += 1;
    }
    for (const row of this.outbox.values()) {
      const stale = row.status === 'dispatching' && now.getTime() - row.updatedAt.getTime() > 60_000;
      if (stale) {
        row.status = 'pending';
        row.availableAt = now;
        recovered += 1;
      }
      const run = this.runs.get(row.runId);
      if (run?.status === 'queued' && row.status === 'dispatched') {
        row.status = 'pending';
        row.availableAt = now;
        row.publishedAt = null;
        recovered += 1;
      }
    }
    return recovered;
  }

  async tryAcquireLock(connectionId: string, tenantId: string, runId: string, now: Date, ttlMs: number): Promise<boolean> {
    const current = this.locks.get(connectionId);
    if (current && current.runId !== runId && now.getTime() - current.acquiredAt.getTime() < ttlMs) return false;
    this.locks.set(connectionId, { tenantId, runId, acquiredAt: now });
    return true;
  }

  async renewLock(connectionId: string, runId: string, now: Date): Promise<boolean> {
    const current = this.locks.get(connectionId);
    if (!current || current.runId !== runId) return false;
    current.acquiredAt = now;
    return true;
  }

  async releaseLock(connectionId: string, runId: string): Promise<void> {
    const current = this.locks.get(connectionId);
    if (current?.runId === runId) this.locks.delete(connectionId);
  }

  async insertTrigger(row: TriggerRow): Promise<void> {
    this.triggers.set(row.id, copy(row));
  }

  async updateTrigger(tenantId: string, id: string, patch: Partial<TriggerRow>): Promise<TriggerRow | null> {
    const row = this.triggers.get(id);
    if (!row || row.tenantId !== tenantId) return null;
    Object.assign(row, patch, { id, tenantId });
    return copy(row);
  }

  async findTrigger(id: string): Promise<TriggerRow | null> {
    const row = this.triggers.get(id);
    return row ? copy(row) : null;
  }

  async listTriggers(tenantId: string, automationId: string): Promise<TriggerRow[]> {
    return [...this.triggers.values()]
      .filter((row) => row.tenantId === tenantId && row.automationId === automationId)
      .map(copy);
  }

  async listEventTriggers(eventType: string, connectionId: string): Promise<TriggerRow[]> {
    return [...this.triggers.values()]
      .filter(
        (row) =>
          row.kind === 'internal_event' &&
          row.enabled &&
          row.eventType === eventType &&
          row.connectionId === connectionId,
      )
      .map(copy);
  }

  async insertDomainEvent(row: DomainEventRow): Promise<DomainEventRow> {
    const existing = [...this.events.values()].find(
      (candidate) =>
        candidate.tenantId === row.tenantId && candidate.type === row.type && candidate.sourceId === row.sourceId,
    );
    if (existing) return copy(existing);
    this.events.set(row.id, copy(row));
    return copy(row);
  }

  async listPendingDomainEvents(limit: number): Promise<DomainEventRow[]> {
    return [...this.events.values()]
      .filter((row) => row.dispatchedAt === null)
      .slice(0, limit)
      .map(copy);
  }

  async markDomainEventDispatched(id: string, at: Date): Promise<void> {
    const row = this.events.get(id);
    if (row) row.dispatchedAt = at;
  }

  async listSchedules(tenantId: string, automationId: string): Promise<ScheduleLink[]> {
    return this.schedules.filter((schedule) => this.scheduleTenant.get(schedule.id) === `${tenantId}:${automationId}`);
  }

  bindSchedule(tenantId: string, automationId: string, schedule: ScheduleLink): void {
    this.schedules.push(schedule);
    this.scheduleTenant.set(schedule.id, `${tenantId}:${automationId}`);
  }
}

export function emptyRun(partial: Pick<RunRow, 'tenantId' | 'automationId' | 'versionId' | 'origin' | 'idempotencyKey' | 'contentHash' | 'params'> & Partial<RunRow>): RunRow {
  const now = new Date();
  return {
    id: partial.id ?? createId(),
    tenantId: partial.tenantId,
    automationId: partial.automationId,
    versionId: partial.versionId,
    status: partial.status ?? 'queued',
    origin: partial.origin,
    originRef: partial.originRef ?? null,
    idempotencyKey: partial.idempotencyKey,
    contentHash: partial.contentHash,
    params: partial.params,
    summary: partial.summary ?? null,
    error: partial.error ?? null,
    requestedBy: partial.requestedBy ?? null,
    scheduleOccurrenceId: partial.scheduleOccurrenceId ?? null,
    cancelRequested: partial.cancelRequested ?? false,
    forceApproval: partial.forceApproval ?? false,
    leaseOwner: null,
    leaseUntil: null,
    startedAt: null,
    finishedAt: null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}
