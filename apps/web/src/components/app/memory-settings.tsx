import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { PageHeader } from '@/components/app/page-header';

type EpisodeRow = {
  id: string;
  kind: string;
  outcome: string;
  text: string;
  occurredAt: string;
  indexed: boolean;
};

const KIND_LABELS: Record<string, string> = {
  decision: 'Decisão',
  action_outcome: 'Resultado',
  event: 'Evento',
};

const OUTCOME_LABELS: Record<string, string> = {
  approved: 'aprovada',
  rejected: 'rejeitada',
  executed: 'executada',
  failed: 'falhou',
  cancelled: 'cancelada',
};

export function MemorySettings({ episodes }: { episodes: EpisodeRow[] }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Memória da empresa"
        description="Decisões e resultados de ações já aprovadas, rejeitadas ou executadas. Somente leitura."
      />

      {episodes.length === 0 ? (
        <EmptyState
          title="Nenhum episódio ainda"
          description="Aprovar, rejeitar ou executar uma ação registra a memória automaticamente."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {episodes.map((episode) => (
            <li key={episode.id}>
              <Card className="p-4">
                <p className="text-xs text-muted-foreground">
                  {KIND_LABELS[episode.kind] ?? episode.kind} ·{' '}
                  {OUTCOME_LABELS[episode.outcome] ?? episode.outcome} ·{' '}
                  {episode.occurredAt.slice(0, 10)} · {episode.indexed ? 'indexado' : 'pendente de índice'}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{episode.text}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
