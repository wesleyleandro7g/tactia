'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

type Tenant = { id: string; name: string; slug: string; role: string };
type Me = { name: string; email: string; activeTenantId: string | null; role: string | null };

export default function AppPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [meRes, tenantsRes] = await Promise.all([
        fetch('/api/v1/users/me'),
        fetch('/api/v1/tenants'),
      ]);
      if (meRes.status === 401) {
        router.replace('/login');
        return;
      }
      if (!meRes.ok || !tenantsRes.ok) {
        setError('Não foi possível carregar a sessão');
        return;
      }
      const meJson = (await meRes.json()) as { data: Me };
      const tenantsJson = (await tenantsRes.json()) as { data: Tenant[] };
      setMe(meJson.data);
      setTenants(tenantsJson.data);
    }
    void load();
  }, [router]);

  async function switchTenant(id: string) {
    await fetch(`/api/v1/tenants/${id}/switch`, { method: 'POST' });
    router.refresh();
    window.location.reload();
  }

  async function signOut() {
    await authClient.signOut();
    router.push('/login');
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--muted)]">TACTIA</p>
          <h1 className="text-2xl font-semibold">Sua empresa</h1>
        </div>
        <button onClick={signOut} className="text-sm text-[var(--muted)]">
          Sair
        </button>
      </div>
      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
      {me ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          {me.name} · {me.email}
          {me.role ? ` · ${me.role}` : ''}
        </p>
      ) : null}
      <ul className="mt-8 flex flex-col gap-3">
        {tenants.map((tenant) => (
          <li
            key={tenant.id}
            className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
          >
            <div>
              <p className="font-medium">{tenant.name}</p>
              <p className="text-sm text-[var(--muted)]">
                {tenant.slug} · {tenant.role}
              </p>
            </div>
            {me?.activeTenantId === tenant.id ? (
              <span className="text-xs text-[var(--accent)]">ativa</span>
            ) : (
              <button onClick={() => switchTenant(tenant.id)} className="text-sm text-[var(--accent)]">
                usar
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-[var(--muted)]">
        <Link href="/" className="text-[var(--accent)]">
          Voltar
        </Link>
      </p>
    </main>
  );
}
