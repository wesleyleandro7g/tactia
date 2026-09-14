'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/format';

export function ProvisionTenantForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const response = await fetch('/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        slug: form.get('slug') || undefined,
        timezone: form.get('timezone') || undefined,
        currency: form.get('currency') || undefined,
        ownerName: form.get('ownerName'),
        ownerEmail: form.get('ownerEmail'),
        ownerPassword: form.get('ownerPassword'),
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { data?: { tenant?: { id: string } }; error?: { code?: string; message?: string } }
      | null;
    setPending(false);
    if (!response.ok) {
      setError(errorMessage(body?.error?.code, body?.error?.message));
      return;
    }
    const id = body?.data?.tenant?.id;
    router.push(id ? `/tenants/${id}` : '/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-xl gap-4">
      <Field htmlFor="name" label="Nome da empresa">
        <Input id="name" name="name" required minLength={2} />
      </Field>
      <Field htmlFor="slug" label="Slug" hint="Opcional. Gerado a partir do nome se vazio.">
        <Input id="slug" name="slug" pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field htmlFor="timezone" label="Fuso">
          <Input id="timezone" name="timezone" defaultValue="America/Sao_Paulo" />
        </Field>
        <Field htmlFor="currency" label="Moeda">
          <Input id="currency" name="currency" defaultValue="BRL" maxLength={3} />
        </Field>
      </div>
      <Field htmlFor="ownerName" label="Nome do owner">
        <Input id="ownerName" name="ownerName" required minLength={2} />
      </Field>
      <Field htmlFor="ownerEmail" label="E-mail do owner">
        <Input id="ownerEmail" name="ownerEmail" type="email" required />
      </Field>
      <Field htmlFor="ownerPassword" label="Senha provisória" hint="Mínimo 8 caracteres. Envie por outro canal.">
        <Input id="ownerPassword" name="ownerPassword" type="password" required minLength={8} />
      </Field>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="submit" loading={pending} size="md">
        {pending ? 'Criando…' : 'Provisionar'}
      </Button>
    </form>
  );
}
