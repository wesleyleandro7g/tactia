import { timingSafeEqual } from 'node:crypto';
import { logger } from '@tactia/shared';
import { IntelligencePipelineService } from '@tactia/domain';
import { DEFAULT_JOB_RETRY_LIMIT, PgBossJobQueue } from '@tactia/execution';
import { BROWSER_TASK_JOB } from '@tactia/chat/server';

/**
 * Background jobs (Etapa 11 — B4). Same Postgres as the app (`pgboss` schema).
 * Disabled unless `JOBS_ENABLED=true` — serverless/dev keep the inline path.
 */

export const JOBS = {
  tick: 'intelligence.tick',
  daily: 'intelligence.daily',
  weeklyBriefing: 'briefing.weekly',
  sync: 'sync.execute',
  trelloReconcile: 'trello.reconcile',
  trelloPrivacy: 'trello.privacy',
  embedFacts: 'memory.embed_facts',
  ingestDocument: 'knowledge.ingest',
  ingestMedia: 'knowledge.ingest_media',
  /** One firing of a Schedule occurrence (agendamento de ações). */
  scheduleRun: 'schedule.run',
  /** One async WhatsApp agent operation (direct execution + status reply). */
  whatsappAgent: 'whatsapp.agent',
  /** One prepared evidence clarification message (Ops-authorized). */
  evidenceClarification: 'evidence.clarification',
  /** Same name the chat package publishes (`BROWSER_TASK_JOB`). */
  browserTask: BROWSER_TASK_JOB,
} as const;

export type DailyJob = { tenantId: string; now?: string };
export type WeeklyBriefingJob = { tenantId: string; now?: string };
export type EmbedFactsJob = { tenantId: string };
export type IngestDocumentJob = { tenantId: string; documentId: string };
export type IngestMediaJob = { tenantId: string; mediaId: string };
export type TrelloReconcileJob = { tenantId: string; dataSourceId: string; now?: string };
export type TrelloPrivacyJob = { now?: string };
export type ScheduleRunJob = {
  tenantId: string;
  scheduleId: string;
  occurrenceId: string;
  periodKey: string;
  requestId: string;
};
export type WhatsappAgentJobPayload = { tenantId: string; jobId: string };
export type EvidenceClarificationJobPayload = { tenantId: string; clarificationId: string };
export type SyncJob = {
  tenantId: string;
  syncJobId: string;
  requestId: string;
  userId: string | null;
  timezone?: string;
  now?: string;
};

/** Sync + snapshots + insights can exceed the default 15 min job TTL. */
export const DAILY_JOB_EXPIRE_SECONDS = 2 * 60 * 60;

export function jobsEnabled(): boolean {
  return process.env['JOBS_ENABLED'] === 'true';
}

export function cronSecret(): string | undefined {
  const value = process.env['CRON_SECRET']?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** Constant-time compare so a missing/short secret never leaks via timing. */
export function cronSecretMatches(provided: string | null | undefined): boolean {
  const expected = cronSecret();
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

let queue: PgBossJobQueue | null | undefined;

export function getJobQueue(): PgBossJobQueue | null {
  if (queue !== undefined) return queue;
  if (!jobsEnabled()) {
    queue = null;
    return null;
  }
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    logger.warn({ operation: 'jobs_disabled' }, 'JOBS_ENABLED but DATABASE_URL is missing');
    queue = null;
    return null;
  }
  queue = new PgBossJobQueue({ connectionString, retryLimit: DEFAULT_JOB_RETRY_LIMIT });
  return queue;
}

function hourInTz(now: Date, timeZone: string): { hour: number; weekday: number; dateKey: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    hour: Number(get('hour')),
    weekday: weekdayMap[get('weekday')] ?? now.getUTCDay(),
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

export async function runMemoryEmbed(tenantId: string) {
  const { businessFactService, episodeService, playbookService, catalogEmbeddingService } =
    await import('./services');
  const facts = await businessFactService.embedPending({ tenantId });
  const episodes = await episodeService.embedPending({ tenantId });
  const playbooks = await playbookService.embedPending({ tenantId });
  const catalog = await catalogEmbeddingService.embedPending({ tenantId });
  logger.info({
    tenant_id: tenantId,
    operation: 'memory_embed',
    facts: facts.embedded,
    episodes: episodes.embedded,
    playbooks: playbooks.embedded,
    catalog_products: catalog.products,
    catalog_customers: catalog.customers,
  });
  return { facts, episodes, playbooks, catalog };
}

export async function runIntelligenceDaily(tenantId: string, now = new Date()) {
  const { intelligencePipelineService, snapshotService, syncService, tenantRepository, refreshPlanMeasurements } =
    await import('./services');
  const tenant = await tenantRepository.findById({ tenantId });
  const syncJobs = await syncService.syncTenantSources(tenantId, {
    now,
    timezone: tenant?.timezone || 'America/Sao_Paulo',
  });
  const snapshots = await snapshotService.runForTenant(tenantId, { now });
  const pipeline = await intelligencePipelineService.runWindows({
    tenantId,
    skipSnapshots: true,
    windows: IntelligencePipelineService.dailyWindows(now),
    actorCtx: { tenantId, userId: null },
  });
  const measurements = await refreshPlanMeasurements(tenantId, now);
  const memory = await runMemoryEmbed(tenantId);
  logger.info({
    tenant_id: tenantId,
    operation: 'intelligence_daily',
    snapshot_days: snapshots.days,
    sync_sources: syncJobs.length,
    ...pipeline,
  });
  return { snapshots, pipeline, measurements, memory, sync: { sources: syncJobs.length } };
}

export async function enqueueDailyForDueTenants(now = new Date()) {
  const jobQueue = getJobQueue();
  if (!jobQueue) return { enqueued: 0 };
  const { tenantRepository } = await import('./services');
  const tenants = await tenantRepository.listActive();
  let enqueued = 0;
  for (const tenant of tenants) {
    const local = hourInTz(now, tenant.timezone || 'America/Sao_Paulo');
    if (local.hour !== 3) continue;
    await jobQueue.publish<DailyJob>(
      JOBS.daily,
      { tenantId: tenant.id, now: now.toISOString() },
      { singletonKey: `${tenant.id}:${local.dateKey}`, expireInSeconds: DAILY_JOB_EXPIRE_SECONDS },
    );
    if (local.weekday === 1) {
      await jobQueue.publish<WeeklyBriefingJob>(
        JOBS.weeklyBriefing,
        { tenantId: tenant.id, now: now.toISOString() },
        { singletonKey: `${tenant.id}:${local.dateKey}` },
      );
    }
    enqueued += 1;
  }
  return { enqueued };
}

export async function enqueueTrelloReconciliations(now = new Date()) {
  const jobQueue = getJobQueue();
  if (!jobQueue) return { enqueued: 0 };
  const { tenantRepository, dataSourceRepository } = await import('./services');
  const tenants = await tenantRepository.listActive();
  const hourKey = now.toISOString().slice(0, 13);
  let enqueued = 0;
  for (const tenant of tenants) {
    const sources = await dataSourceRepository.listActiveTrello(tenant.id);
    for (const source of sources) {
      await jobQueue.publish<TrelloReconcileJob>(
        JOBS.trelloReconcile,
        { tenantId: tenant.id, dataSourceId: source.id, now: now.toISOString() },
        { singletonKey: `${source.id}:${hourKey}` },
      );
      enqueued += 1;
    }
  }
  return { enqueued };
}

export async function enqueueTrelloPrivacy(now = new Date()) {
  const jobQueue = getJobQueue();
  if (!jobQueue || now.getUTCHours() !== 4) return { enqueued: 0 };
  const id = await jobQueue.publish<TrelloPrivacyJob>(
    JOBS.trelloPrivacy,
    { now: now.toISOString() },
    { singletonKey: now.toISOString().slice(0, 10) },
  );
  return { enqueued: id ? 1 : 0 };
}

export async function runTrelloPrivacy(now = new Date()) {
  const { tenantRepository, dataSourceRepository, rawRecordRepository } = await import('./services');
  const tenants = await tenantRepository.listActive();
  let purged = 0;
  for (const tenant of tenants) {
    const sources = await dataSourceRepository.listActiveTrello(tenant.id);
    for (const source of sources) {
      const config = (source.configuration ?? {}) as Record<string, unknown>;
      const days = config['historyDays'];
      if (days === 30 || days === 90 || days === 180) {
        const result = await rawRecordRepository.purgeTrelloHistory({
          tenantId: tenant.id,
          dataSourceId: source.id,
          before: new Date(now.getTime() - days * 86_400_000),
        });
        purged += result.count;
      }
    }
  }

  const pluginId = process.env['TRELLO_PLUGIN_ID']?.trim();
  const clientId = process.env['TRELLO_OAUTH_CLIENT_ID']?.trim();
  const clientSecret = process.env['TRELLO_OAUTH_CLIENT_SECRET']?.trim();
  let scrubbed = 0;
  if (pluginId && clientId && clientSecret) {
    const tokenResponse = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'read:client.privacy',
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Trello privacy token endpoint returned ${tokenResponse.status}`);
    const tokenBody = await tokenResponse.json() as Record<string, unknown>;
    if (typeof tokenBody['access_token'] !== 'string') throw new Error('Trello privacy access token missing');

    const url = new URL(`https://api.trello.com/1/plugins/${encodeURIComponent(pluginId)}/compliance/memberPrivacy`);
    url.searchParams.set('limit', '1000');
    url.searchParams.set('since', new Date(now.getTime() - 13 * 86_400_000).toISOString());
    const response = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${tokenBody['access_token']}` },
    });
    if (!response.ok) throw new Error(`Trello privacy API returned ${response.status}`);
    const events = await response.json() as Array<Record<string, unknown>>;
    const memberIds = new Set(events
      .filter((event) => ['accountDeleted', 'accountUpdated', 'tokenRevoked', 'tokenExpired'].includes(String(event['event'] ?? '')))
      .map((event) => event['id'])
      .filter((id): id is string => typeof id === 'string'));
    for (const memberId of memberIds) {
      const result = await rawRecordRepository.scrubTrelloMember(memberId);
      scrubbed += result.count;
    }
  }
  logger.info({ operation: 'trello_privacy', purged, scrubbed, status: 'completed' });
  return { purged, scrubbed };
}

export async function startJobWorkers(): Promise<void> {
  const jobQueue = getJobQueue();
  if (!jobQueue) return;

  await jobQueue.start();

  const { executionEngine, syncService, commandCenterService } = await import('./services');
  await jobQueue.useActionRunner(async ({ tenantId, executionId }) => {
    await executionEngine.run(tenantId, executionId);
    await commandCenterService.reconcileExecution(
      {
        requestId: `action-reconcile:${executionId}`,
        tenantId,
        userId: 'system',
        role: 'owner',
      },
      executionId,
    );
  });

  await jobQueue.register<DailyJob>(JOBS.daily, async (data) => {
    await runIntelligenceDaily(data.tenantId, data.now ? new Date(data.now) : new Date());
  });

  await jobQueue.register<WeeklyBriefingJob>(JOBS.weeklyBriefing, async (data) => {
    const services = await import('./services');
    const briefing = (
      services as {
        briefingService?: { generateForTenant: (tenantId: string, now?: Date) => Promise<unknown> };
      }
    ).briefingService;
    if (!briefing) {
      logger.info({ tenant_id: data.tenantId, operation: 'briefing_skipped' }, 'briefing service not wired');
      return;
    }
    await briefing.generateForTenant(data.tenantId, data.now ? new Date(data.now) : new Date());
  });

  await jobQueue.register<SyncJob>(JOBS.sync, async (data) => {
    await syncService.executeSync(data.tenantId, data.syncJobId, {
      requestId: data.requestId,
      userId: data.userId,
      timezone: data.timezone,
      now: data.now,
    });
  });

  await jobQueue.register<TrelloReconcileJob>(JOBS.trelloReconcile, async (data) => {
    await syncService.startSystemSync(data.tenantId, data.dataSourceId, {
      now: data.now ? new Date(data.now) : new Date(),
    });
  });

  await jobQueue.register<TrelloPrivacyJob>(JOBS.trelloPrivacy, async (data) => {
    await runTrelloPrivacy(data.now ? new Date(data.now) : new Date());
  });

  await jobQueue.register<EmbedFactsJob>(JOBS.embedFacts, async (data) => {
    await runMemoryEmbed(data.tenantId);
  });

  await jobQueue.register<IngestDocumentJob>(JOBS.ingestDocument, async (data) => {
    const { knowledgeDocumentService } = await import('./services');
    await knowledgeDocumentService.ingest(data);
  });

  await jobQueue.register<IngestMediaJob>(JOBS.ingestMedia, async (data) => {
    const { mediaIngestService } = await import('./services');
    await mediaIngestService.ingest(data);
  });

  await jobQueue.register<{ tenantId: string; taskId: string }>(JOBS.browserTask, async (data) => {
    const { browserAutomationService } = await import('./browser-automation');
    await browserAutomationService.run(data.tenantId, data.taskId);
  });

  await jobQueue.register<WhatsappAgentJobPayload>(JOBS.whatsappAgent, async (data) => {
    const { runWhatsappAgentJob } = await import('./whatsapp-worker');
    await runWhatsappAgentJob(data.tenantId, data.jobId);
  });

  await jobQueue.register<EvidenceClarificationJobPayload>(
    JOBS.evidenceClarification,
    async (data) => {
      const { runEvidenceClarificationJob } = await import('./clarification-worker');
      await runEvidenceClarificationJob(data.tenantId, data.clarificationId);
    },
  );

  await jobQueue.register<ScheduleRunJob>(JOBS.scheduleRun, async (data) => {
    const { scheduleRunner } = await import('./schedules');
    await scheduleRunner.run(data.tenantId, data.occurrenceId, data.requestId);
  });

  await jobQueue.register<{ now?: string }>(JOBS.tick, async (data) => {
    const now = data.now ? new Date(data.now) : new Date();
    const daily = await enqueueDailyForDueTenants(now);
    const { syncService } = await import('./services');
    const { scheduleService } = await import('./schedules');
    const { browserAutomationService } = await import('./browser-automation');
    const browser = await syncService.enqueueDueBrowserSyncs(now);
    const scheduled = await scheduleService.enqueueDueSchedules(now);
    const expiredBrowserSessions = await browserAutomationService.cleanupExpiredSessions();
    const trelloReconcile = await enqueueTrelloReconciliations(now);
    const trelloPrivacy = await enqueueTrelloPrivacy(now);
    const clarifications = await enqueueQueuedClarifications();
    logger.info({
      operation: 'scheduler_tick',
      daily_enqueued: daily.enqueued,
      browser_enqueued: browser.enqueued,
      schedules_enqueued: scheduled.enqueued,
      schedules_evaluated: scheduled.evaluated,
      expired_browser_sessions: expiredBrowserSessions,
      trello_reconcile_enqueued: trelloReconcile.enqueued,
      trello_privacy_enqueued: trelloPrivacy.enqueued,
      clarifications_enqueued: clarifications.enqueued,
    });
  });

  await jobQueue.unschedule(JOBS.tick, 'hourly');
  await jobQueue.schedule(JOBS.tick, '*/5 * * * *', {}, { tz: 'UTC', key: 'integration-tick' });
  logger.info({ operation: 'job_workers_started' });
}

/**
 * Enqueue a WhatsApp agent operation. When the pg-boss queue is not running
 * (dev/serverless without JOBS_ENABLED) it runs inline via `after()`-style
 * fire-and-forget so the webhook still responds fast.
 */
export async function enqueueWhatsappAgentJob(payload: WhatsappAgentJobPayload): Promise<void> {
  const jobQueue = getJobQueue();
  if (jobQueue && jobQueue.isStarted) {
    await jobQueue.publish<WhatsappAgentJobPayload>(JOBS.whatsappAgent, payload, {
      singletonKey: payload.jobId,
    });
    logger.info({
      tenant_id: payload.tenantId,
      operation: 'wa_job_enqueue',
      queue: 'pg-boss',
      job_id: payload.jobId,
    });
    return;
  }
  logger.info({
    tenant_id: payload.tenantId,
    operation: 'wa_job_enqueue',
    queue: 'inline',
    job_id: payload.jobId,
  });
  const { runWhatsappAgentJob } = await import('./whatsapp-worker');
  // Do not await: keep the webhook ACK fast; errors are handled inside the runner.
  void runWhatsappAgentJob(payload.tenantId, payload.jobId).catch((err) => {
    logger.error({ err, job_id: payload.jobId, operation: 'wa_job_inline_failed' });
  });
}

/**
 * Enqueue every clarification Ops already prepared. The send itself revalidates
 * the gap and the contact policy, so this sweep never decides to contact anyone.
 */
export async function enqueueQueuedClarifications(limit = 50) {
  const { prisma } = await import('@tactia/database');
  const queued = await prisma.evidenceClarification.findMany({
    where: { status: 'queued' },
    select: { id: true, tenantId: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  for (const item of queued) {
    await enqueueEvidenceClarification({ tenantId: item.tenantId, clarificationId: item.id });
  }
  return { enqueued: queued.length };
}

/**
 * Enqueue one prepared evidence clarification. Same pattern as the WhatsApp
 * agent job: pg-boss when enabled, inline fire-and-forget otherwise, so the Ops
 * request stays fast and the send is revalidated at delivery time.
 */
export async function enqueueEvidenceClarification(
  payload: EvidenceClarificationJobPayload,
): Promise<void> {
  const jobQueue = getJobQueue();
  if (jobQueue && jobQueue.isStarted) {
    await jobQueue.publish<EvidenceClarificationJobPayload>(
      JOBS.evidenceClarification,
      payload,
      { singletonKey: payload.clarificationId },
    );
    logger.info({
      tenant_id: payload.tenantId,
      operation: 'clarification_enqueue',
      queue: 'pg-boss',
      clarification_id: payload.clarificationId,
    });
    return;
  }
  logger.info({
    tenant_id: payload.tenantId,
    operation: 'clarification_enqueue',
    queue: 'inline',
    clarification_id: payload.clarificationId,
  });
  const { runEvidenceClarificationJob } = await import('./clarification-worker');
  void runEvidenceClarificationJob(payload.tenantId, payload.clarificationId).catch((err) => {
    logger.error({
      err,
      clarification_id: payload.clarificationId,
      operation: 'clarification_inline_failed',
    });
  });
}
