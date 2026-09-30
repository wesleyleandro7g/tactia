import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/app-shell';
import { TodayBriefing } from '@/components/app/command-center/today-briefing';
import { type NavItem } from '@/components/app/nav';
import { hasAutomations } from '@/lib/automations-flag';
import { emptyTodayBriefing, loadTodayBriefing, toTodaySnapshot } from '@/lib/command-center-today';
import { DEGRADED_TODAY_SNAPSHOT } from '@/lib/command-center-today-view';
import { getServerContext, listUserTenants, type TenantContext } from '@/lib/server-context';
import { hasMinRole } from '@tactia/domain';
import { SIDEBAR_COOKIE_NAME } from '@/lib/sidebar-cookie';

const COMMAND_CENTER_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/chat', label: 'Agente IA' },
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

  let todaySnapshot = null;
  let todayBriefing = null;
  if (ctx.tenantId && ctx.role) {
    let briefing = null;
    try {
      briefing = await loadTodayBriefing(ctx as TenantContext);
    } catch {
      briefing = null;
    }
    if (briefing) {
      todaySnapshot = toTodaySnapshot(briefing);
      todayBriefing = <TodayBriefing briefing={briefing} />;
    } else {
      todaySnapshot = DEGRADED_TODAY_SNAPSHOT;
      todayBriefing = <TodayBriefing briefing={emptyTodayBriefing()} />;
    }
  }

  return (
    <AppShell
      nav={nav}
      tenants={tenants}
      tenantId={ctx.tenantId}
      homeHref="/objectives"
      sidebarDefaultOpen={sidebarDefaultOpen}
      todaySnapshot={todaySnapshot}
      todayBriefing={todayBriefing}
    >
      {children}
    </AppShell>
  );
}
