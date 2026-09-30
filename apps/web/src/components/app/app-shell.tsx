'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavLinks, SignOutButton, sectionTitleFromPath, type NavItem } from '@/components/app/nav';
import { BrandLogo } from '@/components/app/brand-logo';
import { BrandMark } from '@/components/app/brand-mark';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { TenantSwitcher } from '@/components/app/tenant-switcher';
import { TodayChrome } from '@/components/app/command-center/today-chrome';
import type { TodaySnapshot } from '@/components/app/command-center/types';
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
  useSidebar,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

function SidebarBrand({ homeHref }: { homeHref: string }) {
  const { state, isMobile } = useSidebar();
  const collapsed = !isMobile && state === 'collapsed';

  return (
    <Link
      href={homeHref}
      className={cn('inline-flex items-center', collapsed && 'size-8 justify-center')}
    >
      {collapsed ? <BrandMark priority /> : <BrandLogo className="h-7" priority />}
    </Link>
  );
}

export function AppShell({
  nav,
  tenants,
  tenantId,
  homeHref,
  sidebarDefaultOpen = true,
  todaySnapshot,
  todayBriefing,
  children,
}: {
  nav: NavItem[];
  tenants: { id: string; name: string; role: string }[];
  tenantId: string | null;
  homeHref: string;
  sidebarDefaultOpen?: boolean;
  todaySnapshot?: TodaySnapshot | null;
  todayBriefing?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isChat = pathname.startsWith('/chat');
  const isWide = ['/dashboard', '/operations', '/results'].some((route) =>
    pathname.startsWith(route),
  );
  const sectionTitle = sectionTitleFromPath(pathname);
  const today = todaySnapshot ? (
    <TodayChrome snapshot={todaySnapshot}>{todayBriefing}</TodayChrome>
  ) : null;

  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen}>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Ir para o conteúdo
      </a>

      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-4 py-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2">
          <SidebarBrand homeHref={homeHref} />
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
        <header className="flex shrink-0 flex-col border-b border-border md:h-14 md:flex-row md:items-center md:gap-3 md:px-6">
          <div className="flex h-12 items-center gap-3 px-4 md:contents md:px-0">
            <SidebarTrigger className="shrink-0" />
            <p className="min-w-0 truncate font-display text-sm italic text-muted-foreground md:max-w-[10rem] lg:max-w-[14rem]">
              {sectionTitle}
            </p>
            <div className="ml-auto flex shrink-0 items-center gap-2 md:order-last md:ml-0">
              <ThemeToggle />
              {tenantId ? (
                <TenantSwitcher tenants={tenants} activeTenantId={tenantId} />
              ) : (
                <Link href="/onboarding" className="text-sm text-primary hover:underline">
                  Criar empresa
                </Link>
              )}
            </div>
          </div>
          {today ? (
            <div className="min-w-0 flex-1 border-t border-border px-3 py-2 md:border-0 md:px-0 md:py-0">
              {today}
            </div>
          ) : (
            <div className="hidden flex-1 md:block" />
          )}
        </header>

        <main
          id="conteudo"
          tabIndex={-1}
          className={
            isChat
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
              : isWide
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
