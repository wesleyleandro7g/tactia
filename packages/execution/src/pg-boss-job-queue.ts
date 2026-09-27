import { PgBoss } from 'pg-boss';
import { logger } from '@tactia/shared';
import type { JobQueue } from './types';

/**
 * pg-boss driver (spec §46, Etapa 11 — B4). Uses the same Postgres as the app
 * (schema `pgboss`), so no extra infrastructure is needed.
 *
 * Two roles:
 * - `JobQueue` for action executions: the closure cannot be serialized, so
 *   `enqueue` publishes `{ tenantId, executionId }` and a worker registered via
 *   `useActionRunner` resumes the execution by id. Until a runner is registered
 *   (or if the boss is not started) it falls back to running inline — a request
 *   never gets stuck because of the queue.
 * - Generic named jobs (`register`/`publish`/`schedule`) for the intelligence
 *   scheduler (`intelligence.daily`, `briefing.weekly`...).
 */

export const ACTION_EXECUTE_JOB = 'action.execute';
export const DEFAULT_JOB_RETRY_LIMIT = 3;

export type ActionExecuteJob = { tenantId: string; executionId: string };

export type JobHandler<T> = (data: T, meta: { id: string; name: string; signal: AbortSignal }) => Promise<void>;

export type PgBossJobQueueOptions = {
  connectionString: string;
  schema?: string;
  /** How long a job may run before being considered expired. Default 15 min. */
  expireInSeconds?: number;
  /** Retry policy for failed jobs. Default 3 retries with backoff. */
  retryLimit?: number;
  retryDelaySeconds?: number;
  /** Concurrency per worker. Default 2. */
  batchSize?: number;
};

export type PublishOptions = {
  /** Only one job with this key may be queued/active at a time. */
  singletonKey?: string;
  /** Delay start (seconds or Date). */
  startAfter?: number | Date;
  priority?: number;
  /** Override the queue default (15 min). Daily sync+insights needs ~2h. */
  expireInSeconds?: number;
};

export class PgBossJobQueue implements JobQueue {
  readonly name = 'pg-boss';
  private readonly boss: PgBoss;
  private started = false;
  private starting: Promise<void> | null = null;
  private actionRunner: ((job: ActionExecuteJob) => Promise<void>) | null = null;
  private readonly queuesEnsured = new Set<string>();

  constructor(private readonly options: PgBossJobQueueOptions) {
    this.boss = new PgBoss({
      connectionString: options.connectionString,
      schema: options.schema ?? 'pgboss',
    });
    this.boss.on('error', (error) => {
      logger.error({ operation: 'pg_boss_error', err: error.message }, 'pg-boss error');
    });
  }

  get isStarted(): boolean {
    return this.started;
  }

  /** Idempotent. Creates the schema on first run. */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      await this.boss.start();
      this.started = true;
      logger.info({ operation: 'pg_boss_started', schema: this.options.schema ?? 'pgboss' });
    })();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true, timeout: 30_000 });
    this.started = false;
    logger.info({ operation: 'pg_boss_stopped' });
  }

  private async ensureQueue(name: string): Promise<void> {
    if (this.queuesEnsured.has(name)) return;
    const existing = await this.boss.getQueue(name);
    if (!existing) {
      await this.boss.createQueue(name, {
        retryLimit: this.options.retryLimit ?? DEFAULT_JOB_RETRY_LIMIT,
        retryDelay: this.options.retryDelaySeconds ?? 60,
        retryBackoff: true,
        expireInSeconds: this.options.expireInSeconds ?? 15 * 60,
        // Keep finished jobs a week for the runbook, then purge.
        deleteAfterSeconds: 7 * 24 * 60 * 60,
      });
    }
    this.queuesEnsured.add(name);
  }

  // -------------------------------------------------------------------------
  // Generic named jobs
  // -------------------------------------------------------------------------

  /** Register a worker for `name`. Must be called after `start()`. */
  async register<T extends object>(name: string, handler: JobHandler<T>): Promise<void> {
    await this.start();
    await this.ensureQueue(name);
    await this.boss.work<T>(name, { batchSize: this.options.batchSize ?? 2 }, async (jobs) => {
      for (const job of jobs) {
        const startedAt = Date.now();
        logger.info({ operation: 'job_start', job: name, job_id: job.id });
        try {
          await handler(job.data, { id: job.id, name: job.name, signal: job.signal });
          logger.info({ operation: 'job_complete', job: name, job_id: job.id, duration_ms: Date.now() - startedAt });
        } catch (error) {
          logger.error(
            {
              operation: 'job_failed',
              job: name,
              job_id: job.id,
              duration_ms: Date.now() - startedAt,
              err: error instanceof Error ? error.message : String(error),
            },
            'job failed',
          );
          throw error;
        }
      }
    });
  }

  async publish<T extends object>(name: string, data: T, options: PublishOptions = {}): Promise<string | null> {
    await this.start();
    await this.ensureQueue(name);
    return this.boss.send(name, data, {
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(options.startAfter !== undefined ? { startAfter: options.startAfter } : {}),
      ...(options.priority !== undefined ? { priority: options.priority } : {}),
      ...(options.expireInSeconds !== undefined ? { expireInSeconds: options.expireInSeconds } : {}),
    });
  }

  /** Cron schedule (one row per name+key; re-scheduling replaces it). */
  async schedule<T extends object>(
    name: string,
    cron: string,
    data: T | null = null,
    options: { tz?: string; key?: string } = {},
  ): Promise<void> {
    await this.start();
    await this.ensureQueue(name);
    await this.boss.schedule(name, cron, data, {
      tz: options.tz ?? 'UTC',
      ...(options.key ? { key: options.key } : {}),
    } as Parameters<PgBoss['schedule']>[3]);
  }

  async unschedule(name: string, key?: string): Promise<void> {
    if (!this.started) return;
    await this.boss.unschedule(name, key);
  }

  // -------------------------------------------------------------------------
  // JobQueue (action executions)
  // -------------------------------------------------------------------------

  /** Registers the worker that resumes executions by id. */
  async useActionRunner(run: (job: ActionExecuteJob) => Promise<void>): Promise<void> {
    this.actionRunner = run;
    await this.register<ActionExecuteJob>(ACTION_EXECUTE_JOB, (data) => run(data));
  }

  async enqueue(job: { tenantId: string; executionId: string; run: () => Promise<void> }): Promise<void> {
    if (!this.started || !this.actionRunner) {
      // No worker to pick it up: behave like InlineJobQueue.
      logger.info({
        tenant_id: job.tenantId,
        operation: 'action_job_enqueue',
        queue: 'inline-fallback',
        execution_id: job.executionId,
      });
      await job.run();
      return;
    }
    const id = await this.publish<ActionExecuteJob>(
      ACTION_EXECUTE_JOB,
      { tenantId: job.tenantId, executionId: job.executionId },
      { singletonKey: job.executionId },
    );
    logger.info({
      tenant_id: job.tenantId,
      operation: 'action_job_enqueue',
      queue: this.name,
      execution_id: job.executionId,
      job_id: id,
    });
  }
}
