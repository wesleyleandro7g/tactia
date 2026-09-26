import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/app/page-header';
import { TenantActions } from '@/components/app/tenant-actions';
import { TenantTabs } from '@/components/app/tenant-tabs';
import { Badge, statusTone } from '@/components/ui/badge';
import { TENANT_STATUS_LABELS } from '@/lib/format';
import { loadTenantHeader } from '@/lib/tenant-loaders';

export default async function TenantTabsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenant, indicators } = await loadTenantHeader(id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="font-mono text-xs text-primary hover:underline">
          ← Empresas
        </Link>
        <PageHeader
          className="mt-2"
          title={tenant.name}
          description={
            <>
              <span className="font-mono">{tenant.slug}</span> · {tenant.currency} · {tenant.timezone} ·{' '}
              <Badge tone={statusTone(tenant.status)}>{TENANT_STATUS_LABELS[tenant.status] ?? tenant.status}</Badge>
            </>
          }
          actions={<TenantActions tenantId={tenant.id} status={tenant.status} />}
        />
      </div>

      <TenantTabs tenantId={tenant.id} indicators={indicators} />

      {children}
    </div>
  );
}
