'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/feedback';
import { Field, FormInput, FormTextarea, Select } from '@/components/ui/field';
import { errorMessage } from '@/lib/format';

type FactRow = {
  id: string;
  kind: string;
  text: string;
  source: string;
  entityType: string | null;
  entityId: string | null;
  validFrom: string | null;
  validTo: string | null;
  indexed: boolean;
};

const KIND_LABELS: Record<string, string> = {
  fact: 'Fato',
  event: 'Evento',
  preference: 'Preferência',
};

const ENTITY_LABELS: Record<string, string> = {
  seller: 'vendedor',
  product: 'produto',
  customer: 'cliente',
};

export function FactsSettings({ facts }: { facts: FactRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validFrom, setValidFrom] = useState<Date | undefined>();
  const [validTo, setValidTo] = useState<Date | undefined>();

  async function create(form: FormData) {
    setPending(true);
    setError(null);
    const entityType = String(form.get('entityType') ?? '').trim();
    const entityId = String(form.get('entityId') ?? '').trim();
    const validFromValue = String(form.get('validFrom') ?? '');
    const validToValue = String(form.get('validTo') ?? '');
    const response = await fetch('/api/v1/facts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: form.get('kind'),
        text: form.get('text'),
        source: 'user',
        entityType: entityType || null,
        entityId: entityId || null,
        validFrom: validFromValue ? new Date(`${validFromValue}T00:00:00.000Z`).toISOString() : null,
        validTo: validToValue ? new Date(`${validToValue}T23:59:59.000Z`).toISOString() : null,
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
              if (ok) {
                form.reset();
                setValidFrom(undefined);
                setValidTo(undefined);
              }
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
          <Field
            htmlFor="entityType"
            label="Vínculo (opcional)"
            hint="Vincule a um vendedor/produto/cliente para o motor deixar de tratar a queda dessa entidade como anomalia."
          >
            <Select id="entityType" name="entityType" defaultValue="">
              <option value="">Nenhum</option>
              <option value="seller">Vendedor</option>
              <option value="product">Produto</option>
              <option value="customer">Cliente</option>
            </Select>
          </Field>
          <Field htmlFor="entityId" label="ID da entidade (UUID)">
            <FormInput id="entityId" name="entityId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field htmlFor="validFrom" label="Válido de">
              <DatePicker id="validFrom" name="validFrom" value={validFrom} onChange={setValidFrom} />
            </Field>
            <Field htmlFor="validTo" label="Válido até">
              <DatePicker id="validTo" name="validTo" value={validTo} onChange={setValidTo} />
            </Field>
          </div>
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
                    {fact.entityType ? ` · ${ENTITY_LABELS[fact.entityType] ?? fact.entityType}` : ''}
                    {fact.validFrom || fact.validTo
                      ? ` · validade ${fact.validFrom?.slice(0, 10) ?? '—'} → ${fact.validTo?.slice(0, 10) ?? '—'}`
                      : ''}
                    {' · '}
                    {fact.indexed ? 'indexado' : 'pendente de índice'}
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
