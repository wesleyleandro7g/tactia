import type { ConversationRepository, MessageRepository, MessageRole } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertTenantContext, hasMinRole } from '../authz';
import {
  appendMessageSchema,
  createConversationSchema,
  listConversationsQuerySchema,
} from '../schemas/ai';
import { AuditAction, type AuditLogService } from './audit-log-service';

/** Fallback title when a conversation is created without a first message. */
const DEFAULT_TITLE = 'Nova conversa';

function titleFromMessage(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return DEFAULT_TITLE;
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

/**
 * ConversationService owns chat persistence (Conversation + Message).
 *
 * It is intentionally free of any AI/LLM concern: the orchestrator in
 * `@tactia/ai` produces answers, this service stores them. Every read is
 * scoped by `tenantId` from the session; a conversation can only be read by
 * its author or by an owner/admin of the tenant.
 */
export class ConversationService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async create(ctx: RequestContext, raw: unknown, firstMessage?: string) {
    assertTenantContext(ctx);
    const input = createConversationSchema.parse(raw ?? {});

    const conversation = await this.conversations.create({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      title: input.title ?? (firstMessage ? titleFromMessage(firstMessage) : DEFAULT_TITLE),
    });

    await this.auditLogs.record(ctx, {
      action: AuditAction.CONVERSATION_CREATED,
      entityType: 'conversation',
      entityId: conversation.id,
      metadata: { title: conversation.title },
    });

    return conversation;
  }

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listConversationsQuerySchema.parse(query);
    // Conversations are personal: each user only sees their own history.
    return this.conversations.list({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      ...parsed,
    });
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const conversation = await this.conversations.findByIdWithMessages({
      tenantId: ctx.tenantId,
      id,
    });
    if (!conversation) throw new AppError(ErrorCode.NOT_FOUND, 'Conversation not found');
    this.assertCanRead(ctx, conversation.userId);
    return conversation;
  }

  async listMessages(ctx: RequestContext, conversationId: string) {
    assertTenantContext(ctx);
    await this.requireConversation(ctx, conversationId);
    return this.messages.listByConversation({ tenantId: ctx.tenantId, conversationId });
  }

  /** Last `limit` messages, chronological — used to build the LLM prompt. */
  async recentMessages(ctx: RequestContext, conversationId: string, limit = 20) {
    assertTenantContext(ctx);
    await this.requireConversation(ctx, conversationId);
    return this.messages.listRecent({ tenantId: ctx.tenantId, conversationId, limit });
  }

  async appendMessage(ctx: RequestContext, conversationId: string, raw: unknown) {
    assertTenantContext(ctx);
    await this.requireConversation(ctx, conversationId);
    const input = appendMessageSchema.parse(raw);

    const message = await this.messages.create({
      tenantId: ctx.tenantId,
      conversationId,
      role: input.role as MessageRole,
      content: input.content,
      metadata: input.metadata ?? undefined,
    });

    await this.conversations.touch({ tenantId: ctx.tenantId, id: conversationId });
    return message;
  }

  /**
   * Names a fresh conversation after its first user message.
   * No-op when the user already chose a title.
   */
  async renameFromFirstMessage(ctx: RequestContext, conversationId: string, content: string) {
    assertTenantContext(ctx);
    const conversation = await this.requireConversation(ctx, conversationId);
    if (conversation.title !== DEFAULT_TITLE) return conversation;
    return this.conversations.updateTitle({
      tenantId: ctx.tenantId,
      id: conversationId,
      title: titleFromMessage(content),
    });
  }

  /** Returns the conversation, enforcing tenant + read permission. */
  async requireConversation(ctx: RequestContext, conversationId: string) {    assertTenantContext(ctx);
    const conversation = await this.conversations.findById({
      tenantId: ctx.tenantId,
      id: conversationId,
    });
    if (!conversation) throw new AppError(ErrorCode.NOT_FOUND, 'Conversation not found');
    this.assertCanRead(ctx, conversation.userId);
    return conversation;
  }

  private assertCanRead(ctx: RequestContext, ownerId: string) {
    if (ctx.userId === ownerId) return;
    if (hasMinRole(ctx.role, 'admin')) return;
    // Do not leak the existence of another user's conversation.
    throw new AppError(ErrorCode.NOT_FOUND, 'Conversation not found');
  }
}
