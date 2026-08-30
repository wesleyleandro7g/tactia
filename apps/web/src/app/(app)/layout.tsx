import { redirect } from 'next/navigation';
import Link from 'next/link';
import { NavLinks, SignOutButton, type NavItem } from '@/components/app/nav';
import { TenantSwitcher } from '@/components/app/tenant-switcher';
import { getServerContext, listUserTenants } from '@/lib/server-context';
import { isOperator } from '@/lib/operator';

const BASE_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/chat', label: 'Chat' },
  { href: '/approvals', label: 'Aprovações' },
  { href: '/onboarding', label: 'Dados' },
];

/**
 * Shell do app: exige sessão, monta a navegação e o seletor de empresa.
 * O item "Admin" só aparece para quem está na allowlist de operador.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getServerContext();
  if (!ctx.userId) redirect('/login');

  const [tenants, operator] = await Promise.all([listUserTenants(ctx), isOperator(ctx)]);
  const nav = operator ? [...BASE_NAV, { href: '/admin', label: 'Admin' }] : BASE_NAV;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm"
      >
        Ir para o conteúdo
      </a>

      <aside className="border-b border-border bg-card/40 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-4 px-5 py-4 lg:block">
          <Link href="/dashboard" className="text-sm font-semibold tracking-wide">
            TACTIA
          </Link>
          <div className="lg:hidden">
            {ctx.tenantId ? (
              <TenantSwitcher tenants={tenants} activeTenantId={ctx.tenantId} />
            ) : null}
          </div>
        </div>

        <nav aria-label="Navegação principal" className="px-3 pb-4">
          <NavLinks items={nav} />
          <div className="mt-4 border-t border-border pt-3">
            <SignOutButton />
          </div>
        </nav>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="hidden items-center justify-between gap-4 border-b border-border px-8 py-4 lg:flex">
          <p className="text-sm text-muted">Camada de inteligência operacional</p>
          {ctx.tenantId ? (
            <TenantSwitcher tenants={tenants} activeTenantId={ctx.tenantId} />
          ) : (
            <Link href="/onboarding" className="text-sm text-accent">
              Criar empresa
            </Link>
          )}
        </header>

        <main id="conteudo" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
