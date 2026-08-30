'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export type TenantOption = { id: string; name: string; role: string };

/**
 * Seletor de empresa. A troca é feita pela API (`/tenants/:id/switch`), que
 * grava o cookie de tenant — o front nunca decide o tenant por conta própria.
 */
export function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: TenantOption[];
  activeTenantId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const active = tenants.find((tenant) => tenant.id === activeTenantId);

  async function switchTo(id: string) {
    if (id === activeTenantId) {
      setOpen(false);
      return;
    }
    setPending(id);
    await fetch(`/api/v1/tenants/${id}/switch`, { method: 'POST' });
    setPending(null);
    setOpen(false);
    router.refresh();
  }

  if (tenants.length <= 1) {
    return <span className="text-sm font-medium">{active?.name ?? 'Minha empresa'}</span>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-card-hover"
      >
        {active?.name ?? 'Selecionar empresa'}
        <ChevronDown aria-hidden="true" className="h-4 w-4 text-muted" />
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label="Empresas"
          className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {tenants.map((tenant) => {
            const isActive = tenant.id === activeTenantId;
            return (
              <li key={tenant.id} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() => void switchTo(tenant.id)}
                  disabled={pending !== null}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-card-hover',
                    isActive && 'text-accent',
                  )}
                >
                  <span>
                    {tenant.name}
                    <span className="block text-xs text-muted">{tenant.role}</span>
                  </span>
                  {isActive ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
                  {pending === tenant.id ? <span className="text-xs text-muted">…</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
