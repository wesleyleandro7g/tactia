'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavLinks, SignOutButton, type NavItem } from '@/components/app/nav';
import { BrandLogo } from '@/components/app/brand-logo';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { TenantSwitcher } from '@/components/app/tenant-switcher';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

export function AppShell({
  nav,
  tenants,
  tenantId,
  children,
}: {
  nav: NavItem[];
  tenants: { id: string; name: string; role: string }[];
  tenantId: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isChat = pathname.startsWith('/chat');
  const isDashboard = pathname.startsWith('/dashboard');

  return (
    <SidebarProvider defaultOpen>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Ir para o conteúdo
      </a>

      <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border">
        <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
          <Link href="/dashboard" className="inline-flex items-center">
            <BrandLogo className="h-7" priority />
          </Link>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavLinks items={nav} variant="sidebar" />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SignOutButton variant="sidebar" />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="flex h-svh min-h-0 min-w-0 flex-col overflow-hidden bg-background">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 lg:px-6">
          <SidebarTrigger className="lg:hidden" />
          <div className="min-w-0 flex-1">
            {!isChat ? (
              <p className="truncate font-display text-sm italic text-muted-foreground">
                Inteligência operacional
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {tenantId ? (
              <TenantSwitcher tenants={tenants} activeTenantId={tenantId} />
            ) : (
              <Link href="/onboarding" className="text-sm text-primary hover:underline">
                Criar empresa
              </Link>
            )}
          </div>
        </header>

        <main
          id="conteudo"
          tabIndex={-1}
          className={
            isChat
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
              : isDashboard
                ? 'flex min-h-0 w-full min-w-0 flex-1 animate-page-enter flex-col overflow-x-hidden overflow-y-auto px-5 py-8 lg:px-8'
                : 'mx-auto flex w-full max-w-6xl min-h-0 flex-1 animate-page-enter flex-col overflow-y-auto px-5 py-8 lg:px-8'
          }
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
