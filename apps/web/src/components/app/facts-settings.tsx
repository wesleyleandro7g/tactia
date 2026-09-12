'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Field, FormTextarea, Select } from '@/components/ui/field';
import { errorMessage } from '@/lib/format';

type FactRow = {
  id: string;
  kind: string;
  text: string;
  source: string;
  validFrom: string | null;
  validTo: string | null;
};

const KIND_LABELS: Record<string, string> = {
  fact: 'Fato',
  event: 'Evento',
  preference: 'Preferência',
};

export function FactsSettings({ facts }: { facts: FactRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(form: FormData) {
    setPending(true);
    setError(null);
    const response = await fetch('/api/v1/facts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: form.get('kind'),
        text: form.get('text'),
        source: 'user',
      }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return false;
    }
    router.refresh();
    return true;
  }

  async function remove(id: string) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/facts/${id}`, { method: 'DELETE' });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Fatos do negócio</h1>
        <p className="text-sm text-muted-foreground">
          Eventos e preferências que a Tactia deve considerar (ex.: “o vendedor João saiu em março”).
          Também dá para gravar pelo chat.
        </p>
      </header>

      <Card className="p-5">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void create(new FormData(form)).then((ok) => {
              if (ok) form.reset();
            });
          }}
        >
          <Field htmlFor="kind" label="Tipo">
            <Select id="kind" name="kind" defaultValue="fact">
              <option value="fact">Fato</option>
              <option value="event">Evento</option>
              <option value="preference">Preferência</option>
            </Select>
          </Field>
          <Field htmlFor="text" label="Texto">
            <FormTextarea id="text" name="text" rows={3} required minLength={3} />
          </Field>
          <Button type="submit" loading={pending}>
            Guardar fato
          </Button>
        </form>
      </Card>

      {facts.length === 0 ? (
        <EmptyState title="Nenhum fato ativo" description="Registre um evento ou preferência da empresa." />
      ) : (
        <ul className="flex flex-col gap-3">
          {facts.map((fact) => (
            <li key={fact.id}>
              <Card className="flex items-start justify-between gap-3 p-4">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {KIND_LABELS[fact.kind] ?? fact.kind} · {fact.source}
                  </p>
                  <p className="mt-1 text-sm">{fact.text}</p>
                </div>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => void remove(fact.id)}>
                  Remover
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
