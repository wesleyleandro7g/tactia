import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/app-shell';
import { type NavItem } from '@/components/app/nav';
import { getServerContext, listUserTenants } from '@/lib/server-context';
import { hasMinRole } from '@tactia/domain';
import { hasCommandCenter } from '@/lib/command-center-flag';

const COMMAND_CENTER_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/chat', label: 'Agente IA' },
  { href: '/objectives', label: 'Objetivos' },
  { href: '/operations', label: 'Operação' },
  { href: '/results', label: 'Resultados' },
];

const COMMAND_CENTER_TODAY: NavItem = { href: '/today', label: 'Hoje' };
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
        COMMAND_CENTER_TODAY,
      ]
    : [
        ...LEGACY_NAV,
        ...(isAdmin
          ? [API_KEYS_NAV, { href: '/settings/whatsapp', label: 'WhatsApp' }]
          : []),
      ];
  return (
    <AppShell
      nav={nav}
      tenants={tenants}
      tenantId={ctx.tenantId}
      homeHref={commandCenterEnabled ? '/today' : '/dashboard'}
    >
      {children}
    </AppShell>
  );
}
