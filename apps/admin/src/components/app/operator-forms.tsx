'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/format';

export function CreateOperatorForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    const response = await fetch('/api/v1/operators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.get('name'),
        email: data.get('email'),
        password: data.get('password'),
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    setPending(false);
    if (!response.ok) {
      setError(errorMessage(body?.error?.code, body?.error?.message));
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-3 md:grid-cols-4">
      <Field htmlFor="op-name" label="Nome">
        <Input id="op-name" name="name" required />
      </Field>
      <Field htmlFor="op-email" label="E-mail">
        <Input id="op-email" name="email" type="email" required />
      </Field>
      <Field htmlFor="op-password" label="Senha">
        <Input id="op-password" name="password" type="password" required minLength={8} />
      </Field>
      <div className="flex items-end">
        <Button type="submit" loading={pending} variant="secondary">
          {pending ? 'Criando…' : 'Criar operador'}
        </Button>
      </div>
      {error ? <div className="md:col-span-4"><Alert tone="danger">{error}</Alert></div> : null}
    </form>
  );
}

export function DisableOperatorButton({
  operatorId,
  disabled,
}: {
  operatorId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    if (!window.confirm('Desativar este operador?')) return;
    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/operators/${operatorId}/disable`, { method: 'POST' });
    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    setPending(false);
    if (!response.ok) {
      setError(errorMessage(body?.error?.code, body?.error?.message));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="danger" loading={pending} disabled={disabled} onClick={() => void run()}>
        Desativar
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
