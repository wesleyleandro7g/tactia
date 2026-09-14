'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { errorMessage } from '@/lib/format';

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string }; data?: { status?: string; id?: string } }
    | null;
  if (!response.ok) {
    throw new Error(errorMessage(payload?.error?.code, payload?.error?.message));
  }
  return payload?.data;
}

async function patchJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(errorMessage(payload?.error?.code, payload?.error?.message));
  }
}

export function TenantActions({ tenantId, status }: { tenantId: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nextStatus = status === 'active' ? 'suspended' : 'active';
  const label = status === 'active' ? 'Suspender' : 'Reativar';

  async function run() {
    setPending(true);
    setError(null);
    try {
      await patchJson(`/api/v1/tenants/${tenantId}`, { status: nextStatus });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant={status === 'active' ? 'danger' : 'default'} loading={pending} onClick={() => void run()}>
        {pending ? 'Salvando…' : label}
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

export function TenantProfileForm({
  tenantId,
  name,
  timezone,
  currency,
}: {
  tenantId: string;
  name: string;
  timezone: string;
  currency: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await patchJson(`/api/v1/tenants/${tenantId}`, {
        name: form.get('name'),
        timezone: form.get('timezone'),
        currency: form.get('currency'),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-xl gap-3 sm:grid-cols-3">
      <Field htmlFor="name" label="Nome" className="sm:col-span-3">
        <Input id="name" name="name" defaultValue={name} required />
      </Field>
      <Field htmlFor="timezone" label="Fuso">
        <Input id="timezone" name="timezone" defaultValue={timezone} required />
      </Field>
      <Field htmlFor="currency" label="Moeda">
        <Input id="currency" name="currency" defaultValue={currency} maxLength={3} required />
      </Field>
      <div className="flex items-end">
        <Button type="submit" loading={pending} variant="secondary">
          {pending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
      {error ? <div className="sm:col-span-3"><Alert tone="danger">{error}</Alert></div> : null}
    </form>
  );
}

export function AddUserForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/v1/tenants/${tenantId}/users`, {
        name: data.get('name'),
        email: data.get('email'),
        password: data.get('password'),
        role: data.get('role'),
      });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar usuário');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-5">
      <Field htmlFor="user-name" label="Nome">
        <Input id="user-name" name="name" required />
      </Field>
      <Field htmlFor="user-email" label="E-mail">
        <Input id="user-email" name="email" type="email" required />
      </Field>
      <Field htmlFor="user-password" label="Senha">
        <Input id="user-password" name="password" type="password" required minLength={8} />
      </Field>
      <Field htmlFor="user-role" label="Papel">
        <Select id="user-role" name="role" defaultValue="member">
          <option value="admin">admin</option>
          <option value="member">member</option>
          <option value="viewer">viewer</option>
        </Select>
      </Field>
      <div className="flex items-end">
        <Button type="submit" loading={pending} variant="secondary">
          {pending ? 'Adicionando…' : 'Adicionar'}
        </Button>
      </div>
      {error ? <div className="md:col-span-5"><Alert tone="danger">{error}</Alert></div> : null}
    </form>
  );
}

export function MembershipControls({
  tenantId,
  membershipId,
  role,
  status,
}: {
  tenantId: string;
  membershipId: string;
  role: string;
  status: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function patch(body: Record<string, string>) {
    setPending(true);
    setError(null);
    try {
      await patchJson(`/api/v1/tenants/${tenantId}/memberships/${membershipId}`, body);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <Select
          defaultValue={role}
          disabled={pending}
          onChange={(event) => void patch({ role: event.target.value })}
          aria-label="Papel"
        >
          <option value="owner">owner</option>
          <option value="admin">admin</option>
          <option value="member">member</option>
          <option value="viewer">viewer</option>
        </Select>
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          onClick={() => void patch({ status: status === 'suspended' ? 'active' : 'suspended' })}
        >
          {status === 'suspended' ? 'Reativar' : 'Suspender'}
        </Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

export function ResetPasswordButton({ tenantId, userId }: { tenantId: string; userId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    const password = window.prompt('Nova senha provisória (mín. 8 caracteres)');
    if (!password) return;
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/v1/tenants/${tenantId}/users/${userId}/password`, { password });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao resetar senha');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="secondary" loading={pending} onClick={() => void run()}>
        Resetar senha
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

export function SyncButton({
  tenantId,
  dataSourceId,
  label = 'Disparar sync',
}: {
  tenantId: string;
  dataSourceId: string;
  label?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const data = await postJson(`/api/v1/tenants/${tenantId}/sync`, { dataSourceId });
      setMessage(data?.status ? `Job ${data.id?.slice(0, 8)} — ${data.status}` : 'Solicitado.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no sync');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="secondary" loading={pending} onClick={() => void run()}>
        {pending ? 'Sincronizando…' : label}
      </Button>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

export function ReprocessButton({ tenantId, importId }: { tenantId: string; importId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/v1/tenants/${tenantId}/reprocess-import`, { importId });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao reprocessar');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="secondary" loading={pending} onClick={() => void run()}>
        {pending ? 'Reprocessando…' : 'Reprocessar'}
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
