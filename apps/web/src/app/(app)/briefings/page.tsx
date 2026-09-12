import Link from 'next/link';
import { ChatMessageContent } from '@/components/app/chat-message-content';
import { GenerateBriefingButton } from '@/components/app/generate-briefing-button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { formatDate } from '@/lib/format';
import { requireTenant } from '@/lib/server-context';
import { briefingService } from '@/lib/services';

export const metadata = { title: 'Briefings · Tactia' };

export default async function BriefingsPage() {
  const ctx = await requireTenant('/briefings');
  const briefings = await briefingService.list(ctx);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Briefings</h1>
          <p className="text-sm text-muted-foreground">
            Resumo semanal gerado a partir dos números da empresa. Cada valor do texto existe nos
            fatos calculados — o modelo não inventa.
          </p>
        </div>
        <GenerateBriefingButton />
      </header>

      {briefings.length === 0 ? (
        <EmptyState
          title="Nenhum briefing ainda"
          description="Gere o primeiro resumo da semana ou aguarde a segunda-feira (job diário)."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {briefings.map((briefing) => (
            <li key={briefing.id}>
              <Card className="p-5">
                <p className="mb-3 text-xs text-muted-foreground">
                  {formatDate(briefing.periodFrom)} a {formatDate(briefing.periodTo)} · gerado em{' '}
                  {formatDate(briefing.createdAt)} · {briefing.model}
                </p>
                <ChatMessageContent content={briefing.content} variant="assistant" />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        <Link href="/dashboard" className="underline-offset-2 hover:underline">
          Voltar ao dashboard
        </Link>
      </p>
    </div>
  );
}
