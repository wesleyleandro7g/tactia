import { createId } from '@tactia/shared';
import type { MessageRole, PrismaClient } from '../client';

export type CreateMessageInput = {
  tenantId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** Sources, tool calls, model — see AI safety (spec §43) */
  metadata?: unknown;
};

export class MessageRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateMessageInput) {
    return this.db.message.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        metadata: (input.metadata ?? undefined) as never,
      },
    });
  }

  createBrowserResult(input: {
    tenantId: string;
    conversationId: string;
    browserTaskId: string;
    content: string;
    metadata: unknown;
  }) {
    return this.db.message.upsert({
      where: { browserTaskId: input.browserTaskId },
      update: {},
      create: {
        id: createId(),
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        browserTaskId: input.browserTaskId,
        role: 'assistant',
        content: input.content,
        metadata: input.metadata as never,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.message.findFirst({ where: { id, tenantId } });
  }

  /** Chronological history of a conversation (oldest first). */
  async listByConversation({
    tenantId,
    conversationId,
    limit,
  }: {
    tenantId: string;
    conversationId: string;
    limit?: number;
  }) {
    return this.db.message.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'asc' },
      ...(limit ? { take: limit } : {}),
    });
  }

  /** Last N messages of a conversation, returned in chronological order. */
  async listRecent({
    tenantId,
    conversationId,
    limit = 20,
  }: {
    tenantId: string;
    conversationId: string;
    limit?: number;
  }) {
    const rows = await this.db.message.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.reverse();
  }

  async count({ tenantId, conversationId }: { tenantId: string; conversationId: string }) {
    return this.db.message.count({ where: { tenantId, conversationId } });
  }
}
