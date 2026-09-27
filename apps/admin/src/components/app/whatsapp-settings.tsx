'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { errorMessage, formatDateTime } from '@/lib/format';

export type WhatsappNumberRow = {
  id: string;
  phone: string;
  label: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  disabledAt: string | null;
  createdAt: string;
};

export type WhatsappUserOption = {
  id: string;
  name: string;
  email: string;
};

function describeError(code?: string, message?: string) {
  if (code === 'CONFLICT') return 'Este número já está cadastrado.';
  if (code === 'VALIDATION_ERROR' && message) return message;
  return errorMessage(code);
}

export function WhatsappSettings({
  numbers,
  users,
  apiBasePath,
}: {
  numbers: WhatsappNumberRow[];
  users: WhatsappUserOption[];
  apiBasePath: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localNumbers, setLocalNumbers] = useState<WhatsappNumberRow[] | null>(null);

  const displayed = localNumbers ?? numbers;
  const active = displayed.filter((row) => !row.disabledAt);
  const disabled = displayed.filter((row) => row.disabledAt);

  async function create(form: FormData): Promise<boolean> {
    const phone = String(form.get('phone') ?? '').trim();
    const userId = String(form.get('userId') ?? '').trim();
    const label = String(form.get('label') ?? '').trim();
    if (!phone || !userId) {
      setError('Informe o número e o usuário.');
      return false;
    }
    setPending(true);
    setError(null);
    const response = await fetch(`${apiBasePath}/numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, userId, ...(label ? { label } : {}) }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setError(describeError(body?.error?.code, body?.error?.message));
      return false;
    }
    const payload = (await response.json()) as {
      data?: {
        id: string;
        phone: string;
        label: string | null;
        userId: string;
        user?: { name: string; email: string };
        disabledAt: string | null;
        createdAt: string;
      };
    };
    const created = payload.data;
    if (created) {
      const row: WhatsappNumberRow = {
        id: created.id,
        phone: created.phone,
        label: created.label,
        userId: created.userId,
        userName: created.user?.name ?? 'Usuário',
        userEmail: created.user?.email ?? '',
        disabledAt: created.disabledAt,
        createdAt: created.createdAt,
      };
      setLocalNumbers([row, ...displayed.filter((item) => item.id !== row.id)]);
    }
    router.refresh();
    return true;
  }

  async function disable(id: string) {
    if (!window.confirm('Desativar este número? O assistente para de responder mensagens dele.')) return;
    setPending(true);
    setError(null);
    const response = await fetch(`${apiBasePath}/numbers/${id}`, { method: 'DELETE' });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setError(describeError(body?.error?.code, body?.error?.message));
      return;
    }
    const now = new Date().toISOString();
    setLocalNumbers((current) =>
      (current ?? numbers).map((row) => (row.id === id ? { ...row, disabledAt: now } : row)),
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <h2 className="text-base font-medium text-foreground">Autorizar número</h2>
        {users.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Cadastre um usuário ativo nesta empresa antes de autorizar um número.
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
            <Field htmlFor="wa-phone" label="Número" hint="DDI + DDD + número, só dígitos. Ex.: 5511999999999">
              <Input id="wa-phone" name="phone" inputMode="numeric" placeholder="5511999999999" required maxLength={32} />
            </Field>
            <Field htmlFor="wa-user" label="Usuário">
              <Select id="wa-user" name="userId" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.email}
                  </option>
                ))}
              </Select>
            </Field>
            <Field htmlFor="wa-label" label="Apelido" hint="Opcional">
              <Input id="wa-label" name="label" placeholder="Celular do João" maxLength={80} />
            </Field>
            <Button type="submit" loading={pending} className="self-start">
              Autorizar
            </Button>
          </form>
        )}
      </Card>

      {active.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Nenhum número autorizado.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((row) => (
            <li key={row.id}>
              <Card className="flex flex-row items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-foreground">{row.label ?? row.phone}</p>
                  <p className="font-mono text-xs text-muted-foreground">{row.phone}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.userName} · {row.userEmail}
                    {` · desde ${formatDateTime(row.createdAt)}`}
                  </p>
                </div>
                <Button type="button" variant="danger" disabled={pending} onClick={() => void disable(row.id)}>
                  Desativar
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {disabled.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Desativados</h2>
          <ul className="flex flex-col gap-2">
            {disabled.map((row) => (
              <li key={row.id} className="text-sm text-muted-foreground">
                {row.phone} · {row.userName}
                {row.disabledAt ? ` · desativado em ${formatDateTime(row.disabledAt)}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
