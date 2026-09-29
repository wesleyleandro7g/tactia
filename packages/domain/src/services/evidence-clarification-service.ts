import { z } from 'zod';
import type {
  ClarificationPolicy,
  EvidenceClarificationRepository,
} from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertOperator } from '../authz';

export const prepareEvidenceClarificationSchema = z.object({
  numberId: z.string().uuid(),
  question: z.string().trim().min(5).max(320),
});

const AMBIGUOUS_PATTERNS = [
  /\bn[aã]o sei\b/i,
  /\btalvez\b/i,
  /\bacho\b/i,
  /\bvou (ver|verificar|confirmar)\b/i,
  /\bdepois\b/i,
  /\bsem certeza\b/i,
];

export function clarificationResponseIsClear(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 2) return false;
  return !AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(normalized));
}

function localParts(now: Date, timeZone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? now.getUTCHours());
  const weekdayName = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return { hour, weekday: weekdays[weekdayName] ?? now.getUTCDay() };
}

export function evaluateClarificationPolicy(input: {
  policy: ClarificationPolicy;
  sentLast24Hours: number;
  lastSentAt: Date | null;
  now: Date;
}): { allowed: true } | { allowed: false; reason: string } {
  const { policy, sentLast24Hours, lastSentAt, now } = input;
  if (!policy.enabled) return { allowed: false, reason: 'Esclarecimentos proativos estão desativados para esta empresa.' };
  const local = localParts(now, policy.timezone);
  if (!policy.weekdays.includes(local.weekday)) {
    return { allowed: false, reason: 'A política não permite contato neste dia.' };
  }
  if (local.hour < policy.startHour || local.hour >= policy.endHour) {
    return { allowed: false, reason: 'A política não permite contato neste horário.' };
  }
  if (sentLast24Hours >= policy.maxPerDay) {
    return { allowed: false, reason: 'O orçamento diário de contato desta pessoa foi atingido.' };
  }
  if (
    lastSentAt &&
    now.getTime() - lastSentAt.getTime() < policy.cooldownHours * 60 * 60 * 1000
  ) {
    return { allowed: false, reason: 'O intervalo mínimo desde o último contato ainda não terminou.' };
  }
  return { allowed: true };
}

export class EvidenceClarificationService {
  constructor(private readonly repository: EvidenceClarificationRepository) {}

  async prepare(ctx: RequestContext, gapId: string, raw: unknown, now = new Date()) {
    assertOperator(ctx);
    const input = prepareEvidenceClarificationSchema.parse(raw);
    const gap = await this.repository.getGap(gapId);
    if (!gap) throw new AppError(ErrorCode.NOT_FOUND, 'Evidence gap not found');
    if (['resolved', 'unresolved'].includes(gap.status)) {
      throw new AppError(ErrorCode.CONFLICT, 'This evidence gap is already closed');
    }
    const active = gap.clarifications.find((item) =>
      ['queued', 'sending', 'sent'].includes(item.status),
    );
    if (active) return active;

    const number = await this.repository.getNumber(gap.tenantId, input.numberId);
    if (!number) throw new AppError(ErrorCode.NOT_FOUND, 'Authorized WhatsApp number not found');
    const policy = this.repository.policyFrom(gap);
    const [sentLast24Hours, latest] = await Promise.all([
      this.repository.countSentSince(input.numberId, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      this.repository.latestSent(input.numberId),
    ]);
    const decision = evaluateClarificationPolicy({
      policy,
      sentLast24Hours,
      lastSentAt: latest?.sentAt ?? null,
      now,
    });
    if (!decision.allowed) {
      throw new AppError(ErrorCode.CONFLICT, decision.reason);
    }
    return this.repository.upsertQueued({
      tenantId: gap.tenantId,
      gapId,
      numberId: number.id,
      question: input.question,
    });
  }

  async claimForSend(tenantId: string, id: string, now = new Date()) {
    const clarification = await this.repository.claimForSend(tenantId, id, now);
    if (!clarification) return { status: 'ignored' as const };
    if (['resolved', 'unresolved'].includes(clarification.gap.status)) {
      await this.repository.cancel(tenantId, id, 'A lacuna foi resolvida antes do envio.');
      return { status: 'cancelled' as const };
    }
    const policy = this.repository.policyFrom(clarification.gap);
    const [sentLast24Hours, latest] = await Promise.all([
      this.repository.countSentSince(
        clarification.numberId,
        new Date(now.getTime() - 24 * 60 * 60 * 1000),
        clarification.id,
      ),
      this.repository.latestSent(clarification.numberId, clarification.id),
    ]);
    const decision = evaluateClarificationPolicy({
      policy,
      sentLast24Hours,
      lastSentAt: latest?.sentAt ?? null,
      now,
    });
    if (!decision.allowed) {
      await this.repository.markFailed(tenantId, id, decision.reason);
      return { status: 'blocked' as const, reason: decision.reason };
    }
    return { status: 'ready' as const, clarification };
  }

  markSent(tenantId: string, id: string, sentAt = new Date()) {
    return this.repository.markSent(tenantId, id, sentAt);
  }

  markFailed(tenantId: string, id: string, error: string) {
    return this.repository.markFailed(tenantId, id, error);
  }

  async receiveInbound(input: {
    tenantId: string;
    numberId: string;
    text: string;
    messageId: string;
    receivedAt?: Date;
  }) {
    const pending = await this.repository.findPendingByNumber(input.tenantId, input.numberId);
    if (!pending) return { handled: false as const };
    const clear = clarificationResponseIsClear(input.text);
    const recorded = await this.repository.recordResponse({
      tenantId: input.tenantId,
      clarificationId: pending.id,
      text: input.text.trim().slice(0, 4000),
      messageId: input.messageId,
      clear,
      receivedAt: input.receivedAt ?? new Date(),
    });
    return recorded
      ? { handled: true as const, clear, gapId: pending.gapId }
      : { handled: false as const };
  }
}
