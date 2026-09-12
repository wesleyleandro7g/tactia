'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Icon as LucideIcon } from 'lucide-react';
import {
  BookOpen,
  ClipboardCheck,
  Database,
  FileText,
  Files,
  History,
  Key,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessageSquare,
  Shield,
  Target,
} from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

export type NavItem = { href: string; label: string };

const NAV_ICONS: Record<string, LucideIcon> = {
  '/dashboard': LayoutDashboard,
  '/briefings': FileText,
  '/chat': MessageSquare,
  '/approvals': ClipboardCheck,
  '/settings/goals': Target,
  '/settings/facts': BookOpen,
  '/settings/memory': History,
  '/settings/playbooks': ListChecks,
  '/settings/documents': Files,
  '/settings/api-keys': Key,
  '/onboarding': Database,
  '/admin': Shield,
};

/** Marca o item ativo com aria-current e destaca visualmente. */
export function NavLinks({
  items,
  onNavigate,
  variant = 'default',
}: {
  items: NavItem[];
  onNavigate?: () => void;
  variant?: 'default' | 'sidebar';
}) {
  const pathname = usePathname();

  if (variant === 'sidebar') {
    return (
      <>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = NAV_ICONS[item.href];
          return (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                render={<Link href={item.href} onClick={onNavigate} />}
                isActive={active}
                tooltip={item.label}
              >
                {Icon ? <Icon /> : null}
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = NAV_ICONS[item.href];
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-accent-soft font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {Icon ? <Icon className="size-4 shrink-0" /> : null}
              <span>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SignOutButton({ variant = 'default' }: { variant?: 'default' | 'sidebar' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await authClient.signOut();
    router.push('/login');
  }

  const confirmDialog = (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sair da conta?</AlertDialogTitle>
          <AlertDialogDescription>
            Você precisará entrar novamente para acessar o painel.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void signOut()}>
            Sair
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (variant === 'sidebar') {
    return (
      <>
        <SidebarMenuButton
          onClick={() => setOpen(true)}
          className="text-muted-foreground"
          tooltip="Sair"
        >
          <LogOut />
          <span>Sair</span>
        </SidebarMenuButton>
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <LogOut className="size-4 shrink-0" />
        <span>Sair</span>
      </button>
      {confirmDialog}
    </>
  );
}
