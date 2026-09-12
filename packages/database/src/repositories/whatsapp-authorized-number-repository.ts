import { createId } from '@tactia/shared';
import type { Prisma, PrismaClient } from '../client';

export type CreateWhatsappAuthorizedNumberInput = {
  tenantId: string;
  userId: string;
  phone: string;
  label?: string | null;
};

const withUser = {
  user: { select: { id: true, name: true, email: true } },
} as const;

export type WhatsappAuthorizedNumberRecord = Prisma.WhatsappAuthorizedNumberGetPayload<{
  include: typeof withUser;
}>;

export class WhatsappAuthorizedNumberRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateWhatsappAuthorizedNumberInput) {
    return this.db.whatsappAuthorizedNumber.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        userId: input.userId,
        phone: input.phone,
        label: input.label ?? null,
      },
      include: withUser,
    });
  }

  async list({ tenantId }: { tenantId: string }) {
    return this.db.whatsappAuthorizedNumber.findMany({
      where: { tenantId },
      include: withUser,
      orderBy: [{ disabledAt: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.whatsappAuthorizedNumber.findFirst({
      where: { id, tenantId },
      include: withUser,
    });
  }

  async findByPhone(phone: string) {
    return this.db.whatsappAuthorizedNumber.findUnique({
      where: { phone },
      include: withUser,
    });
  }

  async findActiveByPhone(phone: string) {
    return this.db.whatsappAuthorizedNumber.findFirst({
      where: { phone, disabledAt: null },
      include: withUser,
    });
  }

  async update({
    tenantId,
    id,
    data,
  }: {
    tenantId: string;
    id: string;
    data: {
      userId?: string;
      phone?: string;
      label?: string | null;
      conversationId?: string | null;
      lastInboundMessageId?: string | null;
      disabledAt?: Date | null;
    };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.whatsappAuthorizedNumber.update({
      where: { id },
      data,
      include: withUser,
    });
  }
}
