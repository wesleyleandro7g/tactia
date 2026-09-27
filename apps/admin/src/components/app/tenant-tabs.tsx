'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  isTenantTabActive,
  syncIndicatorLabel,
  TENANT_TABS,
  tenantTabCount,
  tenantTabHref,
  type TenantTabIndicators,
} from '@/lib/tenant-tabs';

/**
 * Route-based navigation between tenant sections. These are links (not an ARIA
 * tablist) because each tab is its own URL.
 */
export function TenantTabs({
  tenantId,
  indicators,
}: {
  tenantId: string;
  indicators?: TenantTabIndicators;
}) {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Keep the active tab visible when the strip overflows on narrow screens.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  return (
    <nav aria-label="Seções da empresa" className="border-b border-border">
      <ul className="-mb-px flex snap-x gap-1 overflow-x-auto">
        {TENANT_TABS.map((tab) => {
          const active = isTenantTabActive(pathname, tenantId, tab.segment);
          const count = tenantTabCount(tab.key, indicators);
          const alert = tab.key === 'sync' ? syncIndicatorLabel(indicators?.sync) : null;
          return (
            <li key={tab.key} className="shrink-0 snap-start">
              <Link
                ref={active ? activeRef : undefined}
                href={tenantTabHref(tenantId, tab.segment)}
                aria-current={active ? 'page' : undefined}
                title={alert ? `${tab.label}: ${alert}` : undefined}
                className={cn(
                  'flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 font-mono text-xs uppercase tracking-wide transition-colors',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                {count !== undefined ? (
                  <span className="tabular rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {count}
                  </span>
                ) : null}
                {alert ? (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 rounded-full',
                        indicators?.sync === 'failed' ? 'bg-danger' : 'bg-info',
                      )}
                    />
                    <span className="sr-only">({alert})</span>
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
