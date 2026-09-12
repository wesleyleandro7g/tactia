import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/app-shell';
import { type NavItem } from '@/components/app/nav';
import { getServerContext, listUserTenants } from '@/lib/server-context';
import { isOperator } from '@/lib/operator';

const BASE_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/briefings', label: 'Briefings' },
  { href: '/chat', label: 'Chat' },
  { href: '/approvals', label: 'Aprovações' },
  { href: '/settings/goals', label: 'Metas' },
  { href: '/settings/facts', label: 'Fatos' },
  { href: '/settings/memory', label: 'Memória' },
  { href: '/settings/playbooks', label: 'Playbooks' },
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
    <AppShell nav={nav} tenants={tenants} tenantId={ctx.tenantId}>
      {children}
    </AppShell>
  );
}
