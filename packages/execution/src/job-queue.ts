import { logger } from '@tactia/shared';
import type { JobQueue } from './types';

/**
 * V0.1 driver: runs the job in-process and awaits it, so an HTTP response only
 * returns after the execution is recorded. Keeps tests deterministic and works
 * on serverless runtimes (where a background timer would be killed).
 *
 * A pg-boss driver (spec §46) implements the same interface and can replace it
 * at the apps/web wiring without touching the engine.
 */
export class InlineJobQueue implements JobQueue {
  readonly name = 'inline';

  async enqueue(job: {
    tenantId: string;
    executionId: string;
    run: () => Promise<void>;
  }): Promise<void> {
    logger.info({
      tenant_id: job.tenantId,
      operation: 'action_job_enqueue',
      queue: this.name,
      execution_id: job.executionId,
    });
    await job.run();
  }
}
