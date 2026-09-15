import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSourceKind } from '@tactia/domain/data-sources/catalog';
import { ConnectSourceWizard } from '@/components/app/connect-source-wizard';
import { DatabaseConnectWizard } from '@/components/app/database-connect-wizard';
import { connectorScreenCopy } from '@/components/app/connector-steps';
import { PageHeader } from '@/components/app/page-header';
import { requireOperator } from '@/lib/server-context';
import { backofficeService } from '@/lib/services';

type PageProps = {
  params: Promise<{ id: string; kind: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { kind: kindId } = await params;
  if (kindId === 'postgres') {
    return { title: 'Banco de dados · Nova fonte · Tactia Ops' };
  }
  const kind = getSourceKind(kindId);
  return {
    title: kind?.selectable ? `${kind.label} · Nova fonte · Tactia Ops` : 'Nova fonte · Tactia Ops',
  };
}

export default async function NewDataSourceKindPage({ params }: PageProps) {
  const { id, kind: kindId } = await params;
  if (kindId === 'postgres') {
    redirect(`/tenants/${id}/data-sources/new/database`);
  }
  const kind = getSourceKind(kindId);
  if (!kind || !kind.selectable) notFound();

  const { ctx } = await requireOperator(`/tenants/${id}/data-sources/new/${kindId}`);
  const detail = await backofficeService.getTenant(ctx, id).catch(() => null);
  if (!detail) notFound();

  const copy = connectorScreenCopy(kind);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/tenants/${id}/data-sources/new`}
          className="font-mono text-xs text-primary hover:underline"
        >
          ← Tipos de fonte · {detail.tenant.name}
        </Link>
        <PageHeader className="mt-2" title={copy.title} description={copy.description} />
      </div>
      {kind.id === 'database' ? (
        <DatabaseConnectWizard tenantId={id} kind={kind} />
      ) : (
        <ConnectSourceWizard tenantId={id} kind={kind} />
      )}
    </div>
  );
}
