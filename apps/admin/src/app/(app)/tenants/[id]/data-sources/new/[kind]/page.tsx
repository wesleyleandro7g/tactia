import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSourceKind } from '@tactia/domain/data-sources/catalog';
import { ConnectSourceWizard } from '@/components/app/connect-source-wizard';
import { connectorScreenCopy } from '@/components/app/connector-steps';
import { PageHeader } from '@/components/app/page-header';
import { requireOperator } from '@/lib/server-context';
import { backofficeService } from '@/lib/services';

type PageProps = {
  params: Promise<{ id: string; kind: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { kind: kindId } = await params;
  const kind = getSourceKind(kindId);
  return {
    title: kind?.selectable ? `${kind.label} · Nova fonte · Tactia Ops` : 'Nova fonte · Tactia Ops',
  };
}

export default async function NewDataSourceKindPage({ params }: PageProps) {
  const { id, kind: kindId } = await params;
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
      <ConnectSourceWizard tenantId={id} kind={kind} />
    </div>
  );
}
