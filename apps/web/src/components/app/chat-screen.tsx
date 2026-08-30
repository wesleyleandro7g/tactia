import { hasMinRole } from '@tactia/domain';
import { ChatPanel, type ChatMessageView } from '@/components/app/chat-panel';
import { ConversationList } from '@/components/app/conversation-list';
import { requireTenant } from '@/lib/server-context';
import { conversationService } from '@/lib/services';

/** Um chat só é utilizável se houver provider de LLM configurado (ou mock). */
export function llmConfigured(): boolean {
  return Boolean(process.env['LLM_API_KEY']) || process.env['LLM_PROVIDER'] === 'mock';
}

type MessageRow = {
  id: string;
  role: string;
  content: string;
  metadata: unknown;
};

/** Extrai `sources`/`proposals` do metadata persistido pela Etapa 6/7. */
export function toMessageView(message: MessageRow): ChatMessageView {
  const metadata = (message.metadata ?? {}) as {
    sources?: ChatMessageView['sources'];
    proposals?: ChatMessageView['proposals'];
  };

  return {
    id: message.id,
    role: message.role as ChatMessageView['role'],
    content: message.content,
    sources: metadata.sources ?? [],
    proposals: metadata.proposals ?? [],
  };
}

/**
 * Layout compartilhado entre `/chat` (nova conversa) e `/chat/[id]`.
 * Server Component: histórico e permissões vêm do servidor.
 */
export async function ChatScreen({ conversationId }: { conversationId: string | null }) {
  const ctx = await requireTenant('/chat');

  const [conversationPage, messages] = await Promise.all([
    conversationService.list(ctx, { page: '1', pageSize: '20' }),
    conversationId
      ? conversationService.listMessages(ctx, conversationId)
      : Promise.resolve([] as MessageRow[]),
  ]);

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[16rem_1fr] lg:gap-8">
      <div className="order-2 lg:order-1">
        <ConversationList
          conversations={conversationPage.items}
          {...(conversationId ? { activeId: conversationId } : {})}
        />
      </div>

      <div className="order-1 lg:order-2">
        <h1 className="mb-4 text-2xl font-semibold">Chat</h1>
        <ChatPanel
          conversationId={conversationId}
          initialMessages={(messages as MessageRow[]).map(toMessageView)}
          llmConfigured={llmConfigured()}
          canApprove={hasMinRole(ctx.role, 'admin')}
        />
      </div>
    </div>
  );
}
