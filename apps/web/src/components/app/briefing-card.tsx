import Link from 'next/link';
import { ChatMessageContent } from '@/components/app/chat-message-content';
import { Card } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

export function BriefingCard({
  briefing,
}: {
  briefing: {
    id: string;
    periodFrom: Date;
    periodTo: Date;
    content: string;
    model: string;
  } | null;
}) {
  return (
    <section aria-labelledby="briefing" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="briefing" className="font-display text-xl tracking-tight">
            Briefing da semana
          </h2>
          <p className="text-sm text-muted-foreground">
            Narrativa a partir dos fatos numéricos do período.
          </p>
        </div>
        <Link
          href="/briefings"
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Ver todos
        </Link>
      </div>
      <Card className="p-5">
        {briefing ? (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {formatDate(briefing.periodFrom)} a {formatDate(briefing.periodTo)}
            </p>
            <div className="line-clamp-8">
              <ChatMessageContent content={briefing.content} variant="assistant" />
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
