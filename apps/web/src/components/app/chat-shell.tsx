'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Menu } from 'lucide-react';
import type { ChatMessageView } from '@tactia/chat/protocol';
import { ChatPanel, persistentChatEndpoints } from '@tactia/chat/ui';
import { Button } from '@/components/ui/button';
import { ConversationList, type ConversationSummary } from '@/components/app/conversation-list';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/**
 * Shell do chat: sidebar de conversas + área principal em altura fixa.
 */
export function ChatShell({
  conversationId,
  conversations,
  initialMessages,
  llmConfigured,
  canApprove,
  canControl,
}: {
  conversationId: string | null;
  conversations: ConversationSummary[];
  initialMessages: ChatMessageView[];
  llmConfigured: boolean;
  canApprove: boolean;
  canControl: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const contextType = searchParams.get('contextType');
  const contextId = searchParams.get('contextId');
  const endpoints = useMemo(
    () => persistentChatEndpoints(
      contextId && (contextType === 'plan' || contextType === 'objective')
        ? { type: contextType, resourceId: contextId }
        : undefined,
    ),
    [contextId, contextType],
  );
  // `?q=` (ex.: "Perguntar no chat" de um insight): new conversations send it
  // automatically; existing ones keep it as an editable draft.
  const question = searchParams.get('q')?.trim();
  const prefill = useMemo(
    () => (question ? { question, autoSend: conversationId === null } : null),
    [question, conversationId],
  );

  const activeConversation = conversations.find((c) => c.id === conversationId);
  const headerTitle = activeConversation?.title ?? 'Nova conversa';

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      <aside
        className="hidden h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar lg:flex"
        aria-label="Histórico de conversas"
      >
        <ConversationList
          conversations={conversations}
          {...(conversationId ? { activeId: conversationId } : {})}
        />
      </aside>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[min(18rem,85vw)] p-0 lg:hidden">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="text-sm">Conversas</SheetTitle>
          </SheetHeader>
          <ConversationList
            conversations={conversations}
            {...(conversationId ? { activeId: conversationId } : {})}
            onNavigate={() => setSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 lg:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Abrir histórico de conversas"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-base tracking-tight">{headerTitle}</h1>
          </div>
        </header>

        <ChatPanel
          mode="persistent"
          endpoints={endpoints}
          conversationId={conversationId}
          initialMessages={initialMessages}
          llmConfigured={llmConfigured}
          canApprove={canApprove}
          canControl={canControl}
          prefill={prefill}
          onTurnComplete={({ conversationId: id, createdConversation }) => {
            if (createdConversation && id) router.replace(`/chat/${id}`);
            router.refresh();
          }}
          onApprovalResolved={() => router.refresh()}
        />
      </div>
    </div>
  );
}
