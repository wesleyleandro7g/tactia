'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { errorMessage, formatDateTime } from '@/lib/format';

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

export type ApiKeyOwner = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export function ApiKeysSettings({
  keys,
  owners,
  apiBasePath,
}: {
  keys: ApiKeyRow[];
  owners: ApiKeyOwner[];
  apiBasePath: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [localKeys, setLocalKeys] = useState<ApiKeyRow[] | null>(null);

  const displayed = localKeys ?? keys;
  const active = displayed.filter((key) => !key.revokedAt);
  const revoked = displayed.filter((key) => key.revokedAt);

  async function create(form: FormData): Promise<boolean> {
    const name = String(form.get('name') ?? '').trim();
    const userId = String(form.get('userId') ?? '').trim();
    if (!name) {
      setError('Dê um nome à chave.');
      return false;
    }
    if (!userId) {
      setError('Selecione o usuário responsável pela chave.');
      return false;
    }
    setPending(true);
    setError(null);
    const scopes = form.get('allowPropose') === 'on' ? ['tools:read', 'tools:propose'] : ['tools:read'];
    const response = await fetch(apiBasePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, userId, scopes }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setError(body?.error?.message ?? errorMessage(body?.error?.code));
      return false;
    }
    const payload = (await response.json()) as { data?: ApiKeyRow & { secret?: string } };
    const created = payload.data;
    setSecret(created?.secret ?? null);
    setCopied(false);
    if (created) {
      const { secret: _secret, ...row } = created;
      void _secret;
      setLocalKeys([row, ...displayed.filter((key) => key.id !== row.id)]);
    }
    return true;
  }

  async function revoke(id: string) {
    if (!window.confirm('Revogar esta chave? Clientes MCP que a usam passam a receber 401.')) return;
    setPending(true);
    setError(null);
    const response = await fetch(`${apiBasePath}/${id}/revoke`, { method: 'POST' });
    setPending(false);
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
    <div className="flex flex-col gap-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {secret ? (
        <Card className="border-primary/40">
          <h2 className="text-base font-medium text-foreground">Copie agora</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Este secret não será mostrado de novo. Guarde-o no cliente MCP.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={secret} className="flex-1 text-xs" />
            <Button type="button" onClick={() => void copySecret()}>
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="mt-2"
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
        <h2 className="text-base font-medium text-foreground">Nova chave</h2>
        {owners.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Cadastre um owner ou admin nesta empresa antes de emitir uma chave.
          </p>
        ) : (
          <form
            className="mt-3 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              void create(new FormData(form)).then((ok) => {
                if (ok) form.reset();
              });
            }}
          >
            <Field htmlFor="api-key-name" label="Nome">
              <Input id="api-key-name" name="name" placeholder="Claude Desktop" required maxLength={80} />
            </Field>
            <Field htmlFor="api-key-owner" label="Responsável" hint="A chave age em nome deste usuário.">
              <Select id="api-key-owner" name="userId" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name} · {owner.email} ({owner.role})
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" name="allowPropose" />
              Permitir propor ações (ainda entra na fila de aprovação)
            </label>
            <Button type="submit" loading={pending} className="self-start">
              Emitir chave
            </Button>
          </form>
        )}
      </Card>

      {active.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Nenhuma chave ativa.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((key) => (
            <li key={key.id}>
              <Card className="flex flex-row items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-foreground">{key.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">tactia_live_{key.prefix}_…</p>
                  <p className="text-xs text-muted-foreground">
                    Criada em {formatDateTime(key.createdAt)}
                    {key.lastUsedAt ? ` · último uso ${formatDateTime(key.lastUsedAt)}` : ' · nunca usada'}
                  </p>
                </div>
                <Button type="button" variant="danger" disabled={pending} onClick={() => void revoke(key.id)}>
                  Revogar
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {revoked.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Revogadas</h2>
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
    </div>
  );
}
