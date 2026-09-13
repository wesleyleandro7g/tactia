'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Field, FormInput, Select } from '@/components/ui/field';
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
}: {
  numbers: WhatsappNumberRow[];
  users: WhatsappUserOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disableId, setDisableId] = useState<string | null>(null);
  const [localNumbers, setLocalNumbers] = useState<WhatsappNumberRow[] | null>(null);

  const displayed = localNumbers ?? numbers;
  const active = displayed.filter((row) => !row.disabledAt);
  const disabled = displayed.filter((row) => row.disabledAt);

  async function create(formData: FormData): Promise<boolean> {
    const phone = String(formData.get('phone') ?? '').trim();
    const userId = String(formData.get('userId') ?? '').trim();
    const label = String(formData.get('label') ?? '').trim();
    if (!phone || !userId) {
      setError('Informe o número e o usuário.');
      return false;
    }
    setPending(true);
    setError(null);
    const response = await fetch('/api/v1/whatsapp/numbers', {
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
    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/whatsapp/numbers/${id}`, { method: 'DELETE' });
    setPending(false);
    setDisableId(null);
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="WhatsApp"
        description="Cadastre os números autorizados a falar com o assistente da Tactia no WhatsApp. Cada número fica ligado a um usuário desta empresa e usa o mesmo contexto do chat web."
      />

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card>
        <h2 className="text-base font-medium">Autorizar número</h2>
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
          <Field
            htmlFor="wa-phone"
            label="Número"
            hint="DDI + DDD + número, só dígitos. Ex.: 5511999999999"
          >
            <FormInput
              id="wa-phone"
              name="phone"
              inputMode="numeric"
              placeholder="5511999999999"
              required
              maxLength={32}
            />
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
            <FormInput id="wa-label" name="label" placeholder="Celular do João" maxLength={80} />
          </Field>
          <Button type="submit" loading={pending}>
            Autorizar
          </Button>
        </form>
      </Card>

      {active.length === 0 ? (
        <EmptyState
          title="Nenhum número autorizado"
          description="Autorize o WhatsApp de cada pessoa da empresa que deve usar o chat pelo celular."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((row) => (
            <li key={row.id}>
              <Card className="flex flex-row items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{row.label ?? row.phone}</p>
                  <p className="font-mono text-xs text-muted-foreground">{row.phone}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.userName} · {row.userEmail}
                    {` · desde ${formatDateTime(row.createdAt)}`}
                  </p>
                </div>
                <Button type="button" variant="destructive" onClick={() => setDisableId(row.id)}>
                  Desativar
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {disabled.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Desativados</h2>
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

      <AlertDialog open={disableId !== null} onOpenChange={(open) => !open && setDisableId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar este número?</AlertDialogTitle>
            <AlertDialogDescription>
              Mensagens deste WhatsApp deixam de ser respondidas pelo assistente. Você pode
              autorizar o mesmo número de novo depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => disableId && void disable(disableId)}
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
