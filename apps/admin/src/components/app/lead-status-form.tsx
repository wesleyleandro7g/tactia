'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ACQUISITION_STATUSES } from '@tactia/shared/acquisition';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export function LeadStatusForm({ id, initialStatus }: { id: string; initialStatus: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    setSaved(false);
    try {
      const response = await fetch('/api/v1/acquisition-leads/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Não foi possível salvar.');
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha de conexão. Tente novamente.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="lead-status" className="block text-sm font-medium">
        Etapa do atendimento
      </label>
      <div className="flex flex-wrap gap-3">
        <select
          id="lead-status"
          value={status}
          disabled={pending}
          onChange={(event) => {
            setStatus(event.target.value);
            setSaved(false);
          }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          {Object.entries(ACQUISITION_STATUSES)
            .filter(([value]) => value !== 'converted')
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </select>
        <Button type="submit" loading={pending} disabled={pending}>
          Salvar status
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Confirme o horário na agenda do Google antes de marcar “Consultoria agendada”.
      </p>
      {saved && (
        <p role="status" className="text-sm text-primary">
          Status atualizado.
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}
