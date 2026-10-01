import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/app-shell';
import { type NavItem } from '@/components/app/nav';
import { hasAutomations } from '@/lib/automations-flag';
import { getServerContext, listUserTenants } from '@/lib/server-context';
import { hasMinRole } from '@tactia/domain';
import { SIDEBAR_COOKIE_NAME } from '@/lib/sidebar-cookie';

const COMMAND_CENTER_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/chat', label: 'Agente IA' },
  { href: '/settings/company-profile', label: 'Perfil da empresa' },
  { href: '/settings/memory', label: 'Memória' },
  { href: '/objectives', label: 'Objetivos' },
  { href: '/operations', label: 'Operação' },
  { href: '/results', label: 'Resultados' },
];

const API_KEYS_NAV: NavItem = { href: '/settings/api-keys', label: 'API Keys' };

/**
 * Shell do app: exige sessão, monta a navegação e o seletor de empresa.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getServerContext();
  if (!ctx.userId) redirect('/login');

  const tenants = await listUserTenants(ctx);
  const automationsEnabled = await hasAutomations(ctx.tenantId);
  const automationsNav: NavItem[] = automationsEnabled ? [{ href: '/automations', label: 'Automações' }] : [];
  const isAdmin = Boolean(ctx.role && hasMinRole(ctx.role, 'admin'));
  const nav: NavItem[] = [
    ...COMMAND_CENTER_NAV,
    ...automationsNav,
    ...(isAdmin ? [API_KEYS_NAV] : []),
  ];

  const sidebarDefaultOpen = (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value !== 'false';

  return (
    <AppShell
      nav={nav}
      tenants={tenants}
      tenantId={ctx.tenantId}
      homeHref="/objectives"
      sidebarDefaultOpen={sidebarDefaultOpen}
    >
      {children}
    </AppShell>
  );
}
