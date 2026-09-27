import { createId } from '@tactia/shared';
import type { Prisma, PrismaClient } from '../client';

export type CreateWhatsappAgentJobInput = {
  tenantId: string;
  numberId: string;
  userId: string;
  conversationId?: string | null;
  requestText: string;
  plan?: string | null;
  messageId?: string | null;
};

export type WhatsappAgentJobRecord = Prisma.WhatsappAgentJobGetPayload<Record<string, never>>;

/** Jobs that are still in-flight and therefore cancellable. */
const ACTIVE_STATUSES = ['queued', 'running'] as const;

export class WhatsappAgentJobRepository {
  constructor(private readonly db: PrismaClient) {}

  create(input: CreateWhatsappAgentJobInput) {
    return this.db.whatsappAgentJob.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        numberId: input.numberId,
        userId: input.userId,
        conversationId: input.conversationId ?? null,
        requestText: input.requestText,
        plan: input.plan ?? null,
        messageId: input.messageId ?? null,
        status: 'queued',
      },
    });
  }

  findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.whatsappAgentJob.findFirst({ where: { id, tenantId } });
  }

  /** The current in-flight (queued/running) job for a number, if any. */
  findActiveByNumber({ tenantId, numberId }: { tenantId: string; numberId: string }) {
    return this.db.whatsappAgentJob.findFirst({
      where: { tenantId, numberId, status: { in: [...ACTIVE_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  markRunning({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.whatsappAgentJob.updateMany({
      where: { id, tenantId, status: 'queued' },
      data: { status: 'running', startedAt: new Date() },
    });
  }

  markDone({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.whatsappAgentJob.updateMany({
      where: { id, tenantId },
      data: { status: 'done', finishedAt: new Date() },
    });
  }

  markFailed({ tenantId, id, error }: { tenantId: string; id: string; error: string }) {
    return this.db.whatsappAgentJob.updateMany({
      where: { id, tenantId },
      data: { status: 'failed', error: error.slice(0, 2000), finishedAt: new Date() },
    });
  }

  /** Flag a cancel request; the worker honors it and flips the final status. */
  requestCancel({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.whatsappAgentJob.updateMany({
      where: { id, tenantId, status: { in: [...ACTIVE_STATUSES] } },
      data: { status: 'cancelled', cancelRequestedAt: new Date(), finishedAt: new Date() },
    });
  }
}
