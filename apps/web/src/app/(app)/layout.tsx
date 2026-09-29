import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/app-shell';
import { type NavItem } from '@/components/app/nav';
import { getServerContext, listUserTenants } from '@/lib/server-context';
import { hasMinRole } from '@tactia/domain';

const COMMAND_CENTER_NAV: NavItem[] = [
  { href: '/today', label: 'Hoje' },
  { href: '/objectives', label: 'Objetivos' },
  { href: '/operations', label: 'Operação' },
  { href: '/results', label: 'Resultados' },
  { href: '/chat', label: 'Conversar com a Tactia' },
  { href: '/dashboard', label: 'Análises' },
];

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

function hasCommandCenter(tenantId: string | null): boolean {
  if (!tenantId) return false;
  const allowed = new Set(
    (process.env.COMMAND_CENTER_TENANT_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return allowed.has('*') || allowed.has(tenantId);
}

/**
 * Shell do app: exige sessão, monta a navegação e o seletor de empresa.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getServerContext();
  if (!ctx.userId) redirect('/login');

  const tenants = await listUserTenants(ctx);
  const commandCenterEnabled = hasCommandCenter(ctx.tenantId);
  const nav: NavItem[] = [
    ...(commandCenterEnabled ? COMMAND_CENTER_NAV : LEGACY_NAV),
  ];
  if (ctx.role && hasMinRole(ctx.role, 'admin')) {
    nav.push(
      { href: '/settings/api-keys', label: 'API keys' },
      { href: '/settings/whatsapp', label: 'WhatsApp' },
    );
  }
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
