'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type TenantChoice = { id: string; name: string; role: string };

export function OAuthCompanySelection({ tenants }: { tenants: TenantChoice[] }) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueFlow() {
    setPending(true);
    setError(null);
    const selection = await fetch('/api/v1/oauth/tenant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, oauthQuery: window.location.search.slice(1) }),
    });
    if (!selection.ok) {
      setPending(false);
      setError('Não foi possível selecionar essa empresa.');
      return;
    }
    const continuation = await authClient.oauth2.continue({ postLogin: true });
    setPending(false);
    if (continuation.error || !continuation.data?.url) {
      setError(continuation.error?.message ?? 'Não foi possível continuar a conexão.');
      return;
    }
    window.location.assign(continuation.data.url);
  }

  return (
    <Card className="w-full max-w-lg gap-5">
      <div>
        <h1 className="font-display text-2xl tracking-tight">Escolha a empresa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Esta conexão do ChatGPT ficará limitada a uma única empresa.
        </p>
      </div>
      {tenants.length ? (
        <div className="flex flex-col gap-3">
          {tenants.map((tenant) => (
            <label
              key={tenant.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3"
            >
              <input
                type="radio"
                name="tenant"
                value={tenant.id}
                checked={tenantId === tenant.id}
                onChange={() => setTenantId(tenant.id)}
              />
              <span className="flex-1 font-medium">{tenant.name}</span>
              <span className="text-xs text-muted-foreground">{tenant.role}</span>
            </label>
          ))}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button type="button" size="md" loading={pending} onClick={() => void continueFlow()}>
            Continuar
          </Button>
        </div>
      ) : (
        <p className="text-sm text-destructive">Sua conta não possui uma empresa ativa.</p>
      )}
    </Card>
  );
}
