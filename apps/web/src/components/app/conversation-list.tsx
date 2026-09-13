import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: Date | string;
};

/** Histórico de conversas — sidebar com scroll próprio. */
export function ConversationList({
  conversations,
  activeId,
  onNavigate,
}: {
  conversations: ConversationSummary[];
  activeId?: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-3">
        <Link
          href="/chat"
          onClick={onNavigate}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'w-full justify-start gap-2',
          )}
        >
          <MessageSquare className="size-4" aria-hidden="true" />
          Nova conversa
        </Link>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Conversas" className="px-2 py-2">
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Nenhuma conversa ainda.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {conversations.map((conversation) => {
                const active = conversation.id === activeId;
                return (
                  <li key={conversation.id}>
                    <Link
                      href={`/chat/${conversation.id}`}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'block rounded-lg px-3 py-2.5 text-sm transition-colors',
                        active
                          ? 'bg-accent-soft font-medium text-primary'
                          : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                      )}
                    >
                      <span className="line-clamp-2 leading-snug">{conversation.title}</span>
                      <span className="mt-1 block text-[0.7rem] text-muted-foreground/80">
                        {formatDateTime(conversation.updatedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </ScrollArea>
    </div>
  );
}
