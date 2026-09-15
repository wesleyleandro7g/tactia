'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, LayoutTemplate, LogOut, Shield } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Empresas', icon: Building2 },
  { href: '/operators', label: 'Operadores', icon: Shield },
  { href: '/infographics', label: 'Infográficos', icon: LayoutTemplate },
];

export function OpsShell({
  operatorName,
  operatorEmail,
  children,
}: {
  operatorName: string;
  operatorEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push('/login');
  }

  return (
    <div className="flex min-h-svh">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="border-b border-sidebar-border px-4 py-4">
          <Link href="/" className="flex flex-col gap-0.5">
            <span className="font-mono text-sm font-semibold tracking-[0.18em] text-primary">TACTIA</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Ops</span>
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' || pathname.startsWith('/tenants') : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 font-mono text-xs uppercase tracking-wide',
                  active
                    ? 'bg-accent-soft text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <p className="truncate font-mono text-xs text-foreground">{operatorName}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{operatorEmail}</p>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={() => void signOut()}>
            <LogOut className="size-3.5" />
            Sair
          </Button>
        </div>
      </aside>
      <main id="conteudo" className="min-w-0 flex-1 overflow-auto p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
