import type {
  AuthorizationPolicy,
  AutomationInputSchema,
  AutomationOriginName,
  AutomationStepDefinition,
  PageConfig,
} from '@tactia/domain';

export type AutomationStatusName = 'draft' | 'published' | 'paused';
export type RunStatusName =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'needs_attention';
export type StepStatusName =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'awaiting_approval'
  | 'cancelled'
  | 'needs_attention';
export type OutboxStatusName = 'pending' | 'dispatching' | 'dispatched';

export type AutomationRow = {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  purpose: string;
  status: AutomationStatusName;
  publishedVersionId: string | null;
  componentKey: string | null;
  parameterDefaults: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type VersionRow = {
  id: string;
  tenantId: string;
  automationId: string;
  version: number;
  inputSchema: AutomationInputSchema;
  outputSchema: Record<string, unknown>;
  steps: AutomationStepDefinition[];
  pageConfig: PageConfig;
  authorizationPolicy: AuthorizationPolicy;
  publishedAt: Date | null;
  createdAt: Date;
};

export type RunRow = {
  id: string;
  tenantId: string;
  automationId: string;
  versionId: string;
  status: RunStatusName;
  origin: AutomationOriginName;
  originRef: string | null;
  idempotencyKey: string;
  contentHash: string;
  params: Record<string, unknown>;
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
};

export type StepRow = {
  id: string;
  tenantId: string;
  runId: string;
  stepKey: string;
  ordinal: number;
  status: StepStatusName;
  attempt: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  retryable: boolean;
  reconciled: boolean;
  actionExecutionId: string | null;
  approvalId: string | null;
  externalExecutionId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type ArtifactRow = {
  id: string;
  tenantId: string;
  runId: string;
  stepRunId: string | null;
  name: string;
  mime: string;
  storageKey: string;
  byteSize: number;
  checksum: string;
  createdAt: Date;
};

export type OutboxRow = {
  id: string;
  tenantId: string;
  runId: string;
  status: OutboxStatusName;
  availableAt: Date;
  publishedAt: Date | null;
  updatedAt: Date;
};

export type TriggerRow = {
  id: string;
  tenantId: string;
  automationId: string;
  kind: 'webhook' | 'internal_event';
  enabled: boolean;
  secretCipher: string | null;
  eventType: string | null;
  connectionId: string | null;
  createdAt: Date;
};

export type DomainEventRow = {
  id: string;
  tenantId: string;
  type: string;
  sourceId: string;
  connectionId: string;
  dispatchedAt: Date | null;
  createdAt: Date;
};

export type ScheduleLink = {
  id: string;
  name: string;
  enabled: boolean;
  frequency: string;
  timezone: string | null;
  recurrenceConfig: { localTime?: string; weekdays?: number[]; dayOfMonth?: number };
  lastRunAt: Date | null;
};

export interface AutomationStore {
  isEnabled(tenantId: string): Promise<boolean>;
  setEnabled(tenantId: string, enabled: boolean): Promise<void>;
  tenantTimezone(tenantId: string): Promise<string>;

  insertAutomation(row: AutomationRow): Promise<void>;
  updateAutomation(tenantId: string, id: string, patch: Partial<AutomationRow>): Promise<AutomationRow | null>;
  findAutomation(tenantId: string, id: string): Promise<AutomationRow | null>;
  listAutomations(tenantId: string): Promise<AutomationRow[]>;

  insertVersion(row: VersionRow): Promise<void>;
  saveVersion(row: VersionRow): Promise<void>;
  findVersion(tenantId: string, id: string): Promise<VersionRow | null>;
  findLatestVersion(tenantId: string, automationId: string): Promise<VersionRow | null>;
  latestVersionNumber(automationId: string): Promise<number>;

  insertRunBundle(input: { run: RunRow; steps: StepRow[]; outbox: OutboxRow }): Promise<'created' | 'duplicate'>;
  findRunByIdempotency(tenantId: string, automationId: string, key: string): Promise<RunRow | null>;
  findRun(tenantId: string, id: string): Promise<RunRow | null>;
  listRuns(tenantId: string, automationId: string, limit: number): Promise<RunRow[]>;
  latestRun(tenantId: string, automationId: string): Promise<RunRow | null>;
  claimRun(tenantId: string, id: string, workerId: string, leaseUntil: Date, now: Date): Promise<RunRow | null>;
  /** Estende a posse só se este worker ainda for o dono e a posse não tiver expirado. */
  renewLease(tenantId: string, id: string, workerId: string, leaseUntil: Date, now: Date): Promise<boolean>;
  updateRun(tenantId: string, id: string, patch: Partial<RunRow>): Promise<void>;
  countRuns(): Promise<Record<string, number>>;

  listSteps(tenantId: string, runId: string): Promise<StepRow[]>;
  updateStep(tenantId: string, id: string, patch: Partial<StepRow>): Promise<void>;
  findStepByExecution(tenantId: string, actionExecutionId: string): Promise<StepRow | null>;

  insertArtifact(row: ArtifactRow): Promise<void>;
  listArtifacts(tenantId: string, runId: string): Promise<ArtifactRow[]>;
  findArtifact(tenantId: string, id: string): Promise<ArtifactRow | null>;

  claimOutbox(now: Date, limit: number): Promise<OutboxRow[]>;
  markOutbox(id: string, status: OutboxStatusName, now: Date): Promise<void>;
  requeueRun(tenantId: string, runId: string, availableAt: Date): Promise<void>;
  recover(now: Date): Promise<number>;

  tryAcquireLock(connectionId: string, tenantId: string, runId: string, now: Date, ttlMs: number): Promise<boolean>;
  renewLock(connectionId: string, runId: string, now: Date): Promise<boolean>;
  releaseLock(connectionId: string, runId: string): Promise<void>;

  insertTrigger(row: TriggerRow): Promise<void>;
  updateTrigger(tenantId: string, id: string, patch: Partial<TriggerRow>): Promise<TriggerRow | null>;
  findTrigger(id: string): Promise<TriggerRow | null>;
  listTriggers(tenantId: string, automationId: string): Promise<TriggerRow[]>;
  listEventTriggers(eventType: string, connectionId: string): Promise<TriggerRow[]>;

  insertDomainEvent(row: DomainEventRow): Promise<DomainEventRow>;
  listPendingDomainEvents(limit: number): Promise<DomainEventRow[]>;
  markDomainEventDispatched(id: string, at: Date): Promise<void>;

  listSchedules(tenantId: string, automationId: string): Promise<ScheduleLink[]>;
}
