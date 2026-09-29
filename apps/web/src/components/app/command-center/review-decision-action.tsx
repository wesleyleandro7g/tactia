'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/format';

type Choice = 'adjust' | 'continue' | 'close';

export function ReviewDecisionAction({
  planId, version, reviewId,
}: { planId: string; version: number; reviewId: string }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(next: Choice) {
    if (next === 'adjust' && reason.trim().length < 3) {
      setChoice(next);
      setError('Descreva brevemente o ajuste para o Ops preparar a próxima versão.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/plans/${planId}/review-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, reviewId, choice: next, reason: next === 'adjust' ? reason : null }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        throw new Error(errorMessage(body?.error?.code, body?.error?.message));
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a decisão.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <p className="text-sm font-medium">Como seguir após esta revisão?</p>
      <p className="text-sm text-muted-foreground">A decisão atualiza apenas o plano. Execuções externas e o resultado observado mantêm seus próprios estados.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" loading={pending && choice === 'continue'} disabled={pending} onClick={() => { setChoice('continue'); void submit('continue'); }}>Continuar acompanhando</Button>
        <Button type="button" variant="secondary" loading={pending && choice === 'adjust'} disabled={pending} onClick={() => { setChoice('adjust'); void submit('adjust'); }}>Solicitar ajuste</Button>
        <Button type="button" variant="secondary" loading={pending && choice === 'close'} disabled={pending} onClick={() => { setChoice('close'); void submit('close'); }}>Encerrar plano</Button>
      </div>
      {choice === 'adjust' ? <label className="flex flex-col gap-1 text-sm">O que deve mudar?
        <textarea className="min-h-20 rounded-md border border-input bg-background p-2" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      </label> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
