'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { ACTION_TYPE_LABELS, errorMessage } from '@/lib/format';

export type RecommendationView = {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  actionType: string | null;
};

type Decision = 'accepted' | 'rejected';

const PRIORITY_LABELS: Record<string, string> = { high: 'Alta', medium: 'Média', low: 'Baixa' };

/**
 * Recomendações pendentes com aceitar/rejeitar (spec §57).
 * A decisão vai pela API (auditada) e o resultado é anunciado em aria-live.
 */
export function RecommendationList({ recommendations }: { recommendations: RecommendationView[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, Decision>>({});
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  async function decide(recommendation: RecommendationView, decision: Decision) {
    setPendingId(recommendation.id);
    setError(null);

    const path = decision === 'accepted' ? 'accept' : 'reject';
    const response = await fetch(`/api/v1/recommendations/${recommendation.id}/${path}`, {
      method: 'POST',
    });

    setPendingId(null);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }

    setDecided((current) => ({ ...current, [recommendation.id]: decision }));
    setAnnouncement(
      decision === 'accepted'
        ? `Recomendação "${recommendation.title}" aceita.`
        : `Recomendação "${recommendation.title}" rejeitada.`,
    );
    router.refresh();
  }

  if (recommendations.length === 0) {
    return <EmptyState title="Nenhuma recomendação pendente" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <ul className="flex flex-col gap-3">
        {recommendations.map((recommendation) => {
          const decision = decided[recommendation.id];
          const busy = pendingId === recommendation.id;

          return (
            <li key={recommendation.id}>
              <Card className="p-4" aria-busy={busy || undefined}>
                <CardHeader className="mb-2">
                  <div>
                    <CardTitle className="text-base">{recommendation.title}</CardTitle>
                    <CardDescription>{recommendation.description}</CardDescription>
                  </div>
                  <Badge tone={decision ? statusTone(decision) : statusTone(recommendation.priority)}>
                    {decision === 'accepted'
                      ? 'Aceita'
                      : decision === 'rejected'
                        ? 'Rejeitada'
                        : `Prioridade ${PRIORITY_LABELS[recommendation.priority] ?? recommendation.priority}`}
                  </Badge>
                </CardHeader>

                {recommendation.actionType ? (
                  <p className="text-xs text-subtle">
                    Ação sugerida:{' '}
                    {ACTION_TYPE_LABELS[recommendation.actionType] ?? recommendation.actionType}
                  </p>
                ) : null}

                {decision ? null : (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      loading={busy}
                      onClick={() => void decide(recommendation, 'accepted')}
                      aria-label={`Aceitar recomendação ${recommendation.title}`}
                    >
                      Aceitar
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void decide(recommendation, 'rejected')}
                      aria-label={`Rejeitar recomendação ${recommendation.title}`}
                    >
                      Rejeitar
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
