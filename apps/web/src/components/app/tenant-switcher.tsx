'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

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
  const [pending, setPending] = useState<string | null>(null);

  const active = tenants.find((tenant) => tenant.id === activeTenantId);

  async function switchTo(id: string) {
    if (id === activeTenantId) return;
    setPending(id);
    await fetch(`/api/v1/tenants/${id}/switch`, { method: 'POST' });
    setPending(null);
    router.refresh();
  }

  if (tenants.length <= 1) {
    return <span className="text-sm font-medium">{active?.name ?? 'Minha empresa'}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="max-w-[14rem]" />}>
        <span className="truncate">{active?.name ?? 'Selecionar empresa'}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Empresas</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenants.map((tenant) => {
          const isActive = tenant.id === activeTenantId;
          return (
            <DropdownMenuItem
              key={tenant.id}
              disabled={pending !== null}
              onClick={() => void switchTo(tenant.id)}
              className={cn('flex items-start justify-between gap-2', isActive && 'text-primary')}
            >
              <span className="min-w-0">
                <span className="block truncate">{tenant.name}</span>
                <span className="block text-xs text-muted-foreground">{tenant.role}</span>
              </span>
              {isActive ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
              {pending === tenant.id ? <span className="text-xs text-muted-foreground">…</span> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
