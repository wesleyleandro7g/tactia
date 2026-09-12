import { timingSafeEqual } from 'node:crypto';
import { logger } from '@tactia/shared';
import { IntelligencePipelineService } from '@tactia/domain';
import { PgBossJobQueue } from '@tactia/execution';

/**
 * Background jobs (Etapa 11 — B4). Same Postgres as the app (`pgboss` schema).
 * Disabled unless `JOBS_ENABLED=true` — serverless/dev keep the inline path.
 */

export const JOBS = {
  tick: 'intelligence.tick',
  daily: 'intelligence.daily',
  weeklyBriefing: 'briefing.weekly',
  sync: 'sync.execute',
  embedFacts: 'memory.embed_facts',
} as const;

export type DailyJob = { tenantId: string; now?: string };
export type WeeklyBriefingJob = { tenantId: string; now?: string };
export type EmbedFactsJob = { tenantId: string };
export type SyncJob = {
  tenantId: string;
  syncJobId: string;
  requestId: string;
  userId: string | null;
};

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
  queue = new PgBossJobQueue({ connectionString });
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
  const { businessFactService, episodeService, playbookService } = await import('./services');
  const facts = await businessFactService.embedPending({ tenantId });
  const episodes = await episodeService.embedPending({ tenantId });
  const playbooks = await playbookService.embedPending({ tenantId });
  logger.info({
    tenant_id: tenantId,
    operation: 'memory_embed',
    facts: facts.embedded,
    episodes: episodes.embedded,
    playbooks: playbooks.embedded,
  });
  return { facts, episodes, playbooks };
}

export async function runIntelligenceDaily(tenantId: string, now = new Date()) {
  const { intelligencePipelineService, snapshotService } = await import('./services');
  const snapshots = await snapshotService.runForTenant(tenantId, { now });
  const pipeline = await intelligencePipelineService.runWindows({
    tenantId,
    skipSnapshots: true,
    windows: IntelligencePipelineService.dailyWindows(now),
    actorCtx: { tenantId, userId: null },
  });
  const memory = await runMemoryEmbed(tenantId);
  logger.info({
    tenant_id: tenantId,
    operation: 'intelligence_daily',
    snapshot_days: snapshots.days,
    ...pipeline,
  });
  return { snapshots, pipeline, memory };
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
      { singletonKey: `${tenant.id}:${local.dateKey}` },
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

export async function startJobWorkers(): Promise<void> {
  const jobQueue = getJobQueue();
  if (!jobQueue) return;

  await jobQueue.start();

  const { executionEngine, syncService } = await import('./services');
  await jobQueue.useActionRunner(async ({ tenantId, executionId }) => {
    await executionEngine.run(tenantId, executionId);
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
    });
  });

  await jobQueue.register<EmbedFactsJob>(JOBS.embedFacts, async (data) => {
    await runMemoryEmbed(data.tenantId);
  });

  await jobQueue.register<{ now?: string }>(JOBS.tick, async (data) => {
    await enqueueDailyForDueTenants(data.now ? new Date(data.now) : new Date());
  });

  await jobQueue.schedule(JOBS.tick, '5 * * * *', {}, { tz: 'UTC', key: 'hourly' });
  logger.info({ operation: 'job_workers_started' });
}
