import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/app-shell';
import { TodayBriefing } from '@/components/app/command-center/today-briefing';
import { type NavItem } from '@/components/app/nav';
import { hasCommandCenter } from '@/lib/command-center-flag';
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

const LEGACY_NAV: NavItem[] = [
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
  const commandCenterEnabled = await hasCommandCenter(ctx.tenantId);
  const isAdmin = Boolean(ctx.role && hasMinRole(ctx.role, 'admin'));
  const nav: NavItem[] = commandCenterEnabled
    ? [
        ...COMMAND_CENTER_NAV,
        ...(isAdmin ? [API_KEYS_NAV] : []),
      ]
    : [
        ...LEGACY_NAV,
        ...(isAdmin
          ? [API_KEYS_NAV, { href: '/settings/whatsapp', label: 'WhatsApp' }]
          : []),
      ];

  const sidebarDefaultOpen = (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value !== 'false';

  let todaySnapshot = null;
  let todayBriefing = null;
  if (commandCenterEnabled && ctx.tenantId && ctx.role) {
    try {
      const briefing = await loadTodayBriefing(ctx as TenantContext);
      todaySnapshot = toTodaySnapshot(briefing);
      todayBriefing = <TodayBriefing briefing={briefing} />;
    } catch {
      todaySnapshot = DEGRADED_TODAY_SNAPSHOT;
      todayBriefing = <TodayBriefing briefing={emptyTodayBriefing()} />;
    }
  }

  return (
    <AppShell
      nav={nav}
      tenants={tenants}
      tenantId={ctx.tenantId}
      homeHref={commandCenterEnabled ? '/objectives' : '/dashboard'}
      sidebarDefaultOpen={sidebarDefaultOpen}
      todaySnapshot={todaySnapshot}
      todayBriefing={todayBriefing}
    >
      {children}
    </AppShell>
  );
}
