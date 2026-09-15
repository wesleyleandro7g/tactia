'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { errorMessage } from '@/lib/format';

type ApiError = { error?: { code?: string; message?: string } };

export function CreateCompanyForm() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createCompany() {
    setPending(true);
    setError(null);
    const response = await fetch('/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: companyName }),
    });
    const json = (await response.json().catch(() => null)) as ApiError | null;
    setPending(false);
    if (!response.ok) {
      setError(json?.error?.message ?? errorMessage(json?.error?.code));
      return;
    }
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <div className="mt-6 flex max-w-md flex-col gap-4">
      {error ? (
        <Alert tone="danger" title="Não foi possível criar a empresa">
          {error}
        </Alert>
      ) : null}
      <Field htmlFor="company" label="Nome da empresa" hint="Aparece no topo do app.">
        <Input
          id="company"
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          autoComplete="organization"
          required
        />
      </Field>
      <Button
        className="self-start"
        loading={pending}
        disabled={companyName.trim().length === 0}
        onClick={() => void createCompany()}
      >
        Criar empresa
      </Button>
    </div>
  );
}
