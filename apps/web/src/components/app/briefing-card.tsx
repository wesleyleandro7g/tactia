import Link from 'next/link';
import { ChatMessageContent } from '@/components/app/chat-message-content';
import { Card } from '@/components/ui/card';
import { briefingNarrative, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export function BriefingCard({
  briefing,
  compact = false,
}: {
  briefing: {
    id: string;
    periodFrom: Date;
    periodTo: Date;
    content: string;
    model: string;
  } | null;
  compact?: boolean;
}) {
  const body = briefing ? (compact ? briefingNarrative(briefing.content) : briefing.content) : null;

  return (
    <section aria-labelledby="briefing" className={cn('flex h-full flex-col gap-3', compact && 'gap-2')}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="briefing" className="font-display text-xl tracking-tight">
            Briefing da semana
          </h2>
          {compact ? null : (
            <p className="text-sm text-muted-foreground">
              Narrativa a partir dos fatos numéricos do período.
            </p>
          )}
        </div>
        <Link
          href="/briefings"
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Ver todos
        </Link>
      </div>
      <Card className={cn('flex flex-1 flex-col p-5', compact && 'border-primary/20 bg-accent-soft/40')}>
        {briefing && body ? (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {formatDate(briefing.periodFrom)} a {formatDate(briefing.periodTo)}
            </p>
            <div className={compact ? 'line-clamp-6 text-sm leading-relaxed' : 'line-clamp-8'}>
              <ChatMessageContent content={body} variant="assistant" />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ainda não há briefing. Gere em{' '}
            <Link href="/briefings" className="font-medium text-primary underline underline-offset-2">
              Briefings
            </Link>{' '}
            ou aguarde a segunda-feira.
          </p>
        )}
      </Card>
    </section>
  );
}
