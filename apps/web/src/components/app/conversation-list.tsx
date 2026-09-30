import Link from 'next/link';
import { Plus } from 'lucide-react';
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
      <div className="flex h-14 shrink-0 items-center border-b border-border px-3">
        <Link
          href="/chat"
          onClick={onNavigate}
          aria-current={!activeId ? 'page' : undefined}
          className={cn(
            'group/new flex h-11 w-full items-center gap-2.5 rounded-lg border bg-card px-1.5 pr-3 text-left shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] transition-[border-color,background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
            'hover:border-primary/30 hover:shadow-[0_8px_22px_rgba(254,114,0,0.12)]',
            'active:translate-y-px dark:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]',
            !activeId
              ? 'border-primary/25 bg-accent-soft'
              : 'border-border',
          )}
        >
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-md bg-brand text-white shadow-[0_1px_0_rgba(255,255,255,0.22)_inset]"
          >
            <Plus className="size-3.5 stroke-[2.5] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/new:rotate-90 motion-reduce:transition-none motion-reduce:group-hover/new:rotate-0" />
          </span>
          <span className="min-w-0 flex-1 truncate font-display text-sm italic tracking-tight text-foreground">
            Nova conversa
          </span>
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
