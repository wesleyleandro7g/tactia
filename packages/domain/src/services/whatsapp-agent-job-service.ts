import type { CreateWhatsappAgentJobInput, WhatsappAgentJobRepository } from '@tactia/database';

/**
 * Dedicated async job lifecycle for WhatsApp agent operations.
 * States: queued → running → done | failed, with cancelled reachable from
 * queued/running. Cancellation is cooperative: `requestCancel` flips the
 * status and the worker honors it around the orchestrator run.
 */
export class WhatsappAgentJobService {
  constructor(private readonly jobs: WhatsappAgentJobRepository) {}

  enqueue(input: CreateWhatsappAgentJobInput) {
    return this.jobs.create(input);
  }

  findById(params: { tenantId: string; id: string }) {
    return this.jobs.findById(params);
  }

  findActiveByNumber(params: { tenantId: string; numberId: string }) {
    return this.jobs.findActiveByNumber(params);
  }

  /** Returns true when the job transitioned from queued to running. */
  async markRunning(params: { tenantId: string; id: string }): Promise<boolean> {
    const result = await this.jobs.markRunning(params);
    return result.count > 0;
  }

  markDone(params: { tenantId: string; id: string }) {
    return this.jobs.markDone(params);
  }

  markFailed(params: { tenantId: string; id: string; error: string }) {
    return this.jobs.markFailed(params);
  }

  /** Returns true when an active job was cancelled. */
  async requestCancel(params: { tenantId: string; id: string }): Promise<boolean> {
    const result = await this.jobs.requestCancel(params);
    return result.count > 0;
  }
}
