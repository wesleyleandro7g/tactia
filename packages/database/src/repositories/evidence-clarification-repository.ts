import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient } from '../client';
import { recordCommandCenterEvent } from './command-center-events';

export type ClarificationPolicy = {
  enabled: boolean;
  startHour: number;
  endHour: number;
  maxPerDay: number;
  cooldownHours: number;
  weekdays: number[];
  timezone: string;
};

export class EvidenceClarificationRepository {
  constructor(private readonly db: PrismaClient) {}

  async getGap(gapId: string) {
    return this.db.evidenceGap.findUnique({
      where: { id: gapId },
      include: {
        tenant: { include: { whatsappAgentConfig: true } },
        plan: true,
        clarifications: { include: { number: true } },
      },
    });
  }

  getNumber(tenantId: string, numberId: string) {
    return this.db.whatsappAuthorizedNumber.findFirst({
      where: { id: numberId, tenantId, disabledAt: null },
      include: { user: true },
    });
  }

  policyFrom(gap: {
    tenant: {
      timezone: string;
      whatsappAgentConfig: {
        clarificationsEnabled: boolean;
        clarificationStartHour: number;
        clarificationEndHour: number;
        clarificationMaxPerDay: number;
        clarificationCooldownHours: number;
        clarificationWeekdays: number[];
      } | null;
    };
  }): ClarificationPolicy {
    const config = gap.tenant.whatsappAgentConfig;
    return {
      enabled: config?.clarificationsEnabled ?? false,
      startHour: config?.clarificationStartHour ?? 9,
      endHour: config?.clarificationEndHour ?? 18,
      maxPerDay: config?.clarificationMaxPerDay ?? 2,
      cooldownHours: config?.clarificationCooldownHours ?? 24,
      weekdays: config?.clarificationWeekdays ?? [1, 2, 3, 4, 5],
      timezone: gap.tenant.timezone,
    };
  }

  countSentSince(numberId: string, since: Date, excludeId?: string) {
    return this.db.evidenceClarification.count({
      where: {
        numberId,
        sentAt: { gte: since },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  latestSent(numberId: string, excludeId?: string) {
    return this.db.evidenceClarification.findFirst({
      where: {
        numberId,
        sentAt: { not: null },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: { sentAt: 'desc' },
    });
  }

  async upsertQueued(input: {
    tenantId: string;
    gapId: string;
    numberId: string;
    question: string;
  }) {
    return this.db.$transaction(async (tx) => {
      const clarification = await tx.evidenceClarification.upsert({
      where: { gapId: input.gapId },
      create: {
        id: createId(),
        tenantId: input.tenantId,
        gapId: input.gapId,
        numberId: input.numberId,
        question: input.question,
        status: 'queued',
      },
      update: {
        numberId: input.numberId,
        question: input.question,
        status: 'queued',
        responseText: null,
        responseMessageId: null,
        answeredAt: null,
        error: null,
      },
      });
      await recordCommandCenterEvent(tx, {
        tenantId: input.tenantId,
        eventKey: `clarification-requested:${clarification.id}:${clarification.attempts}`,
        name: 'clarification_requested',
        entityId: clarification.id,
        metadata: { gapId: input.gapId },
      });
      return clarification;
    });
  }

  /**
   * Atomically reserves the contact slot: the status flip and `sentAt` happen in
   * the same statement, so a concurrent claim for the same person already counts
   * this attempt against the daily budget. A failure/cancel releases it.
   */
  async claimForSend(tenantId: string, id: string, reservedAt: Date) {
    const claimed = await this.db.evidenceClarification.updateMany({
      where: { id, tenantId, status: 'queued' },
      data: { status: 'sending', attempts: { increment: 1 }, sentAt: reservedAt },
    });
    if (claimed.count !== 1) return null;
    return this.db.evidenceClarification.findFirst({
      where: { id, tenantId },
      include: {
        gap: { include: { tenant: { include: { whatsappAgentConfig: true } } } },
        number: true,
      },
    });
  }

  markSent(tenantId: string, id: string, sentAt: Date) {
    return this.db.evidenceClarification.updateMany({
      where: { id, tenantId, status: 'sending' },
      data: { status: 'sent', sentAt, error: null },
    });
  }

  /** Releases the reserved slot: a message that was never delivered must not consume budget. */
  markFailed(tenantId: string, id: string, error: string) {
    return this.db.evidenceClarification.updateMany({
      where: { id, tenantId, status: { in: ['queued', 'sending'] } },
      data: { status: 'failed', error: error.slice(0, 1000), sentAt: null },
    });
  }

  cancel(tenantId: string, id: string, reason: string) {
    return this.db.evidenceClarification.updateMany({
      where: { id, tenantId, status: { in: ['queued', 'sending'] } },
      data: { status: 'cancelled', error: reason.slice(0, 1000), sentAt: null },
    });
  }

  findPendingByNumber(tenantId: string, numberId: string) {
    return this.db.evidenceClarification.findFirst({
      where: { tenantId, numberId, status: 'sent' },
      include: { gap: true },
      orderBy: { sentAt: 'desc' },
    });
  }

  async recordResponse(input: {
    tenantId: string;
    clarificationId: string;
    text: string;
    messageId: string;
    clear: boolean;
    receivedAt: Date;
  }) {
    return this.db.$transaction(async (tx) => {
      // Atomic hand-off: only one inbound can move the question out of `sent`,
      // so two concurrent replies never create two evidences for the same gap.
      const taken = await tx.evidenceClarification.updateMany({
        where: { id: input.clarificationId, tenantId: input.tenantId, status: 'sent' },
        data: { status: 'processing' },
      });
      if (taken.count !== 1) return null;
      const clarification = await tx.evidenceClarification.findFirst({
        where: { id: input.clarificationId, tenantId: input.tenantId },
        include: { gap: true, number: true },
      });
      if (!clarification) return null;
      const evidence = await tx.operationalEvidence.upsert({
        where: {
          tenantId_externalRef: {
            tenantId: input.tenantId,
            externalRef: `whatsapp-message:${input.messageId}`,
          },
        },
        create: {
          id: createId(),
          tenantId: input.tenantId,
          planId: clarification.gap.planId,
          kind: 'reported',
          origin: 'whatsapp',
          summary: input.clear
            ? 'Esclarecimento recebido da pessoa autorizada.'
            : 'Resposta recebida, mas sem confirmação suficiente.',
          sourceLabel: clarification.number.contactName ?? clarification.number.label ?? 'Contato autorizado',
          externalRef: `whatsapp-message:${input.messageId}`,
          eventAt: input.receivedAt,
          payload: {
            clarificationId: clarification.id,
            question: clarification.question,
            response: input.text,
            clear: input.clear,
            numberId: clarification.numberId,
          },
        },
        update: {},
      });
      await tx.evidenceClarification.update({
        where: { id: clarification.id },
        data: {
          status: input.clear ? 'answered' : 'ambiguous',
          responseText: input.text,
          responseMessageId: input.messageId,
          answeredAt: input.receivedAt,
        },
      });
      await tx.evidenceGap.update({
        where: { id: clarification.gapId },
        data: input.clear
          ? {
              status: 'resolved',
              resolution: {
                kind: 'reported',
                evidenceId: evidence.id,
                clarificationId: clarification.id,
              },
              nextStep: null,
              resolvedAt: input.receivedAt,
            }
          : {
              status: 'in_progress',
              nextStep: 'Revisar resposta ambígua; não assumir confirmação.',
              resolution: Prisma.JsonNull,
            },
      });
      await recordCommandCenterEvent(tx, {
        tenantId: input.tenantId,
        eventKey: `clarification-received:${clarification.id}:${clarification.attempts}`,
        name: 'clarification_received',
        entityId: clarification.id,
        metadata: { gapId: clarification.gapId, clear: input.clear },
      });
      return { clarification, evidence, clear: input.clear };
    });
  }
}
