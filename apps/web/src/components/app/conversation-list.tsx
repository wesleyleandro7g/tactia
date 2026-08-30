import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: Date | string;
};

/** Histórico de conversas do usuário (cada usuário vê apenas as suas). */
export function ConversationList({
  conversations,
  activeId,
}: {
  conversations: ConversationSummary[];
  activeId?: string;
}) {
  return (
    <nav aria-label="Conversas" className="flex flex-col gap-3">
      <Link href="/chat" className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
        Nova conversa
      </Link>

      {conversations.length === 0 ? (
        <p className="text-xs text-muted">Nenhuma conversa ainda.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {conversations.map((conversation) => {
            const active = conversation.id === activeId;
            return (
              <li key={conversation.id}>
                <Link
                  href={`/chat/${conversation.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'block rounded-lg px-3 py-2 text-sm transition-colors',
                    active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-card hover:text-fg',
                  )}
                >
                  <span className="line-clamp-2">{conversation.title}</span>
                  <span className="mt-0.5 block text-xs text-subtle">
                    {formatDateTime(conversation.updatedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
