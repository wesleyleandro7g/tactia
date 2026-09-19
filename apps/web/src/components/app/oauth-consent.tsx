'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const LABELS: Record<string, string> = {
  'tools:read': 'Identificar sua conta e consultar dados, métricas, documentos e análises da empresa',
  'tools:propose': 'Criar propostas que aguardam aprovação dentro da Tactia',
  offline_access: 'Manter a conexão ativa até você revogá-la',
  openid: 'Identificar sua conta Tactia',
  profile: 'Exibir seu nome na conexão',
  email: 'Exibir seu e-mail na conexão',
};

export function OAuthConsent({ scopes, companyName }: { scopes: string[]; companyName: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setPending(true);
    setError(null);
    const result = await authClient.oauth2.consent({
      accept,
      scope: scopes.join(' '),
    });
    setPending(false);
    if (result.error || !result.data?.url) {
      setError(result.error?.message ?? 'Não foi possível concluir a autorização.');
      return;
    }
    window.location.assign(result.data.url);
  }

  return (
    <Card className="w-full max-w-lg gap-5">
      <div>
        <h1 className="font-display text-2xl tracking-tight">Autorizar ChatGPT</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O ChatGPT solicita os acessos abaixo para trabalhar com <strong>{companyName}</strong>.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {scopes.map((scope) => (
          <li key={scope} className="rounded-lg border border-border p-3 text-sm">
            {LABELS[scope] ?? scope}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Propostas nunca são executadas automaticamente; elas continuam exigindo aprovação na Tactia.
      </p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => void decide(false)}>
          Cancelar
        </Button>
        <Button type="button" loading={pending} onClick={() => void decide(true)}>
          Autorizar
        </Button>
      </div>
    </Card>
  );
}
