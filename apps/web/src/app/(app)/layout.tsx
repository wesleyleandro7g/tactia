import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/app-shell';
import { type NavItem } from '@/components/app/nav';
import { getServerContext, listUserTenants } from '@/lib/server-context';
import { hasMinRole } from '@tactia/domain';

const BASE_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/briefings', label: 'Briefings' },
  { href: '/chat', label: 'Chat' },
  { href: '/approvals', label: 'Aprovações' },
  { href: '/settings/goals', label: 'Metas' },
  { href: '/settings/facts', label: 'Fatos' },
  { href: '/settings/memory', label: 'Memória' },
  { href: '/settings/playbooks', label: 'Playbooks' },
  { href: '/settings/documents', label: 'Documentos' },
  { href: '/settings/connections', label: 'Conexões' },
];

/**
 * Shell do app: exige sessão, monta a navegação e o seletor de empresa.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getServerContext();
  if (!ctx.userId) redirect('/login');

  const tenants = await listUserTenants(ctx);
  const nav: NavItem[] = [...BASE_NAV];
  if (ctx.role && hasMinRole(ctx.role, 'admin')) {
    nav.push(
      { href: '/settings/api-keys', label: 'API keys' },
      { href: '/settings/whatsapp', label: 'WhatsApp' },
    );
  }
  return (
    <AppShell nav={nav} tenants={tenants} tenantId={ctx.tenantId}>
      {children}
    </AppShell>
  );
}
