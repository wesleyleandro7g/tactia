'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Field, FormInput } from '@/components/ui/field';
import { errorMessage, formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/app/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  role: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function ApiKeysSettings({ keys }: { keys: ApiKeyRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [localKeys, setLocalKeys] = useState<ApiKeyRow[] | null>(null);

  const displayed = localKeys ?? keys;
  const active = displayed.filter((key) => !key.revokedAt);
  const revoked = displayed.filter((key) => key.revokedAt);

  async function create(formData: FormData): Promise<boolean> {
    const name = String(formData.get('name') ?? '').trim();
    if (!name) {
      setError('Dê um nome à chave.');
      return false;
    }
    setPending(true);
    setError(null);
    const scopes = formData.get('allowPropose') === 'on' ? ['tools:read', 'tools:propose'] : ['tools:read'];
    const response = await fetch('/api/v1/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scopes }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return false;
    }
    const payload = (await response.json()) as {
      data?: ApiKeyRow & { secret?: string };
    };
    const created = payload.data;
    setSecret(created?.secret ?? null);
    setCopied(false);
    if (created) {
      const { secret: _omit, ...row } = created;
      setLocalKeys([row, ...displayed.filter((key) => key.id !== row.id)]);
    }
    return true;
  }

  async function revoke(id: string) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/api-keys/${id}/revoke`, { method: 'POST' });
    setPending(false);
    setRevokeId(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }
    const now = new Date().toISOString();
    setLocalKeys((current) =>
      (current ?? keys).map((key) => (key.id === id ? { ...key, revokedAt: now } : key)),
    );
    router.refresh();
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="API keys"
        description="Emita uma chave para clientes MCP (Claude Desktop ou outro agente). Ela executa as mesmas tools do chat, com o tenant congelado na chave. Copie o secret na hora — ele não volta a aparecer."
      />

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {secret ? (
        <Card className="border-primary/40">
          <h2 className="text-base font-medium">Copie agora</h2>
          <p className="text-sm text-muted-foreground">
            Este secret não será mostrado de novo. Guarde-o no cliente MCP.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={secret}
              className="h-10 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-xs"
            />
            <Button type="button" onClick={() => void copySecret()}>
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSecret(null);
              setLocalKeys(null);
              router.refresh();
            }}
          >
            Já copiei
          </Button>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-base font-medium">Nova chave</h2>
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
          <Field htmlFor="api-key-name" label="Nome">
            <FormInput
              id="api-key-name"
              name="name"
              placeholder="Claude Desktop"
              required
              maxLength={80}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="allowPropose" />
            Permitir propor ações (ainda entra na fila de aprovação)
          </label>
          <Button type="submit" loading={pending}>
            Emitir chave
          </Button>
        </form>
      </Card>

      {active.length === 0 ? (
        <EmptyState
          title="Nenhuma chave ativa"
          description="Emita uma chave para conectar um agente externo via MCP."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((key) => (
            <li key={key.id}>
              <Card className="flex flex-row items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{key.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">tactia_live_{key.prefix}_…</p>
                  <p className="text-xs text-muted-foreground">
                    Criada em {formatDateTime(key.createdAt)}
                    {key.lastUsedAt ? ` · último uso ${formatDateTime(key.lastUsedAt)}` : ' · nunca usada'}
                  </p>
                </div>
                <Button type="button" variant="destructive" onClick={() => setRevokeId(key.id)}>
                  Revogar
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {revoked.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Revogadas</h2>
          <ul className="flex flex-col gap-2">
            {revoked.map((key) => (
              <li key={key.id} className="text-sm text-muted-foreground">
                {key.name} · tactia_live_{key.prefix}_… · revogada em{' '}
                {key.revokedAt ? formatDateTime(key.revokedAt) : '—'}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <AlertDialog open={revokeId !== null} onOpenChange={(open) => !open && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar esta chave?</AlertDialogTitle>
            <AlertDialogDescription>
              Clientes MCP que usam este secret passam a receber 401. A linha permanece para auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => revokeId && void revoke(revokeId)}
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
