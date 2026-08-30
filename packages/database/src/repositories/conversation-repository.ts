import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type CreateConversationInput = {
  tenantId: string;
  userId: string;
  title: string;
};

export class ConversationRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateConversationInput) {
    return this.db.conversation.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        userId: input.userId,
        title: input.title,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.conversation.findFirst({ where: { id, tenantId } });
  }

  /** Conversation + full message history, ordered chronologically. */
  async findByIdWithMessages({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.conversation.findFirst({
      where: { id, tenantId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async list({
    tenantId,
    userId,
    page = 1,
    pageSize = 20,
  }: {
    tenantId: string;
    userId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where = { tenantId, ...(userId ? { userId } : {}) };
    const [total, items] = await Promise.all([
      this.db.conversation.count({ where }),
      this.db.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, items, page, pageSize };
  }

  async updateTitle({ tenantId, id, title }: { tenantId: string; id: string; title: string }) {
    return this.db.conversation.update({ where: { id, tenantId }, data: { title } });
  }

  /** Bump updatedAt so the conversation floats to the top of the list. */
  async touch({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.conversation.update({ where: { id, tenantId }, data: { updatedAt: new Date() } });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const result = await this.db.conversation.deleteMany({ where: { id, tenantId } });
    return result.count > 0;
  }
}
