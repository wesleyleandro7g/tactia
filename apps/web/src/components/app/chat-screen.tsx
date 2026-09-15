import { hasMinRole } from '@tactia/domain';
import { ChatShell } from '@/components/app/chat-shell';
import type { ChatMessageView } from '@/components/app/chat-panel';
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

/** Extrai `sources`/`proposals`/`attachments` do metadata persistido. */
export function toMessageView(message: MessageRow): ChatMessageView {
  const metadata = (message.metadata ?? {}) as {
    sources?: ChatMessageView['sources'];
    proposals?: ChatMessageView['proposals'];
    attachments?: ChatMessageView['attachments'];
    followUps?: string[];
    toolCalls?: Array<{ name: string }>;
  };

  return {
    id: message.id,
    role: message.role as ChatMessageView['role'],
    content: message.content,
    sources: metadata.sources ?? [],
    proposals: metadata.proposals ?? [],
    attachments: metadata.attachments ?? [],
    followUps: metadata.followUps ?? [],
    toolsUsed: (metadata.toolCalls ?? []).map((call) => call.name),
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
    <ChatShell
      conversationId={conversationId}
      conversations={conversationPage.items}
      initialMessages={(messages as MessageRow[]).map(toMessageView)}
      llmConfigured={llmConfigured()}
      canApprove={hasMinRole(ctx.role, 'admin')}
    />
  );
}
