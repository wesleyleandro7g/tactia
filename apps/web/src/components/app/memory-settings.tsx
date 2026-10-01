'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormTextarea } from '@/components/ui/field';
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

type SummaryRow = {
  id: string;
  text: string;
  authorName: string;
  updatedAt: string;
  reviewedAt: string | null;
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

export function MemorySettings({ episodes, summaries, canEdit }: { episodes: EpisodeRow[]; summaries: SummaryRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function change(id: string, method: 'PATCH' | 'DELETE') {
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/agent-context/memories/${id}`, {
        method,
        ...(method === 'PATCH' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: draft }) } : {}),
      });
      if (!response.ok) throw new Error('Não foi possível atualizar a memória.');
      setEditing(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao atualizar a memória.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Memória da empresa"
        description="Resumos das conversas compartilhados com a empresa e resultados de ações. O agente não mostra mensagens antigas de outras pessoas."
      />

      <section className="flex flex-col gap-3" aria-labelledby="conversation-memory-title">
        <h2 id="conversation-memory-title" className="text-lg font-semibold">Conversas anteriores</h2>
        {summaries.length === 0 ? <EmptyState title="Nenhum resumo ainda" description="O agente registra contexto duradouro após as conversas. Resumos antigos podem ser processados pela equipe Tactia." /> : (
          <ul className="flex flex-col gap-3">
            {summaries.map((summary) => <li key={summary.id}>
              <Card className="flex flex-col gap-3 p-4">
                <p className="text-xs text-muted-foreground">{summary.authorName} · {summary.updatedAt.slice(0, 10)}{summary.reviewedAt ? ' · revisado' : ''}</p>
                {editing === summary.id ? <>
                  <label htmlFor={`memory-${summary.id}`} className="sr-only">Editar resumo</label>
                  <FormTextarea id={`memory-${summary.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} maxLength={3000} />
                  <div className="flex gap-2"><Button size="sm" disabled={pending || !draft.trim()} onClick={() => void change(summary.id, 'PATCH')}>Salvar correção</Button><Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button></div>
                </> : <>
                  <p className="whitespace-pre-wrap text-sm">{summary.text}</p>
                  {canEdit ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(summary.id); setDraft(summary.text); }}>Corrigir</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => void change(summary.id, 'DELETE')}>Excluir</Button></div> : null}
                </>}
              </Card>
            </li>)}
          </ul>
        )}
      </section>

      <h2 className="text-lg font-semibold">Decisões e resultados</h2>

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
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
