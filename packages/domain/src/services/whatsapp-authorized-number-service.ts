import type { MembershipRepository, WhatsappAuthorizedNumberRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertOwnerOrAdmin } from '../authz';
import { createWhatsappNumberSchema, updateWhatsappNumberSchema } from '../schemas/whatsapp';
import { AuditAction, type AuditLogService } from './audit-log-service';
import { INVALID_WHATSAPP_PHONE, normalizeWhatsappPhone } from '../whatsapp/phone';

export class WhatsappAuthorizedNumberService {
  constructor(
    private readonly numbers: WhatsappAuthorizedNumberRepository,
    private readonly memberships: MembershipRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async list(ctx: RequestContext) {
    assertOwnerOrAdmin(ctx);
    return this.numbers.list({ tenantId: ctx.tenantId });
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = createWhatsappNumberSchema.parse(raw);
    const phone = requirePhone(input.phone);
    await this.requireActiveMember(ctx.tenantId, input.userId);

    const existing = await this.numbers.findByPhone(phone);
    if (existing && existing.tenantId !== ctx.tenantId) {
      throw new AppError(ErrorCode.CONFLICT, 'This WhatsApp number is already registered');
    }
    if (existing && existing.tenantId === ctx.tenantId && !existing.disabledAt) {
      throw new AppError(ErrorCode.CONFLICT, 'This WhatsApp number is already registered');
    }

    if (existing && existing.tenantId === ctx.tenantId && existing.disabledAt) {
      const row = await this.numbers.update({
        tenantId: ctx.tenantId,
        id: existing.id,
        data: {
          userId: input.userId,
          label: input.label ?? existing.label,
          disabledAt: null,
          conversationId: null,
          lastInboundMessageId: null,
        },
      });
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'WhatsApp number not found');
      await this.auditLogs.record(ctx, {
        action: AuditAction.WHATSAPP_NUMBER_CREATED,
        entityType: 'whatsapp_authorized_number',
        entityId: row.id,
        metadata: { phone: row.phone, userId: row.userId, reactivated: true },
      });
      return row;
    }

    try {
      const row = await this.numbers.create({
        tenantId: ctx.tenantId,
        userId: input.userId,
        phone,
        label: input.label,
      });
      await this.auditLogs.record(ctx, {
        action: AuditAction.WHATSAPP_NUMBER_CREATED,
        entityType: 'whatsapp_authorized_number',
        entityId: row.id,
        metadata: { phone: row.phone, userId: row.userId },
      });
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(ErrorCode.CONFLICT, 'This WhatsApp number is already registered');
      }
      throw error;
    }
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = updateWhatsappNumberSchema.parse(raw);
    const current = await this.numbers.findById({ tenantId: ctx.tenantId, id });
    if (!current) throw new AppError(ErrorCode.NOT_FOUND, 'WhatsApp number not found');

    const phone = input.phone !== undefined ? requirePhone(input.phone) : undefined;
    if (phone && phone !== current.phone) {
      const taken = await this.numbers.findByPhone(phone);
      if (taken && taken.id !== current.id) {
        throw new AppError(ErrorCode.CONFLICT, 'This WhatsApp number is already registered');
      }
    }
    if (input.userId && input.userId !== current.userId) {
      await this.requireActiveMember(ctx.tenantId, input.userId);
    }

    try {
      const row = await this.numbers.update({
        tenantId: ctx.tenantId,
        id,
        data: {
          ...(input.userId ? { userId: input.userId } : {}),
          ...(phone ? { phone } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
        },
      });
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'WhatsApp number not found');
      await this.auditLogs.record(ctx, {
        action: AuditAction.WHATSAPP_NUMBER_UPDATED,
        entityType: 'whatsapp_authorized_number',
        entityId: row.id,
        metadata: { phone: row.phone, userId: row.userId },
      });
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(ErrorCode.CONFLICT, 'This WhatsApp number is already registered');
      }
      throw error;
    }
  }

  async disable(ctx: RequestContext, id: string) {
    assertOwnerOrAdmin(ctx);
    const current = await this.numbers.findById({ tenantId: ctx.tenantId, id });
    if (!current) throw new AppError(ErrorCode.NOT_FOUND, 'WhatsApp number not found');
    if (current.disabledAt) return current;
    const row = await this.numbers.update({
      tenantId: ctx.tenantId,
      id,
      data: { disabledAt: new Date(), conversationId: null },
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'WhatsApp number not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.WHATSAPP_NUMBER_DISABLED,
      entityType: 'whatsapp_authorized_number',
      entityId: row.id,
      metadata: { phone: row.phone, userId: row.userId },
    });
    return row;
  }

  findActiveByPhone(phone: string) {
    return this.numbers.findActiveByPhone(phone);
  }

  async resolveActiveInbound(phone: string) {
    const number = await this.numbers.findActiveByPhone(phone);
    if (!number) return null;
    const membership = await this.memberships.findByUserAndTenant({
      tenantId: number.tenantId,
      userId: number.userId,
    });
    if (!membership || membership.status !== 'active') return null;
    return { number, role: membership.role };
  }

  async bindInbound(input: {
    tenantId: string;
    id: string;
    conversationId: string;
    messageId: string;
  }) {
    return this.numbers.update({
      tenantId: input.tenantId,
      id: input.id,
      data: {
        conversationId: input.conversationId,
        lastInboundMessageId: input.messageId,
      },
    });
  }

  private async requireActiveMember(tenantId: string, userId: string) {
    const membership = await this.memberships.findByUserAndTenant({ tenantId, userId });
    if (!membership || membership.status !== 'active') {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Este usuário não é um membro ativo da empresa',
      );
    }
  }
}

function requirePhone(raw: string): string {
  const phone = normalizeWhatsappPhone(raw);
  if (!phone) throw new AppError(ErrorCode.VALIDATION_ERROR, INVALID_WHATSAPP_PHONE);
  return phone;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}
