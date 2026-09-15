import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SourceKindPicker } from '@/components/app/source-kind-picker';
import { PageHeader } from '@/components/app/page-header';
import { requireOperator } from '@/lib/server-context';
import { backofficeService } from '@/lib/services';

export const metadata = { title: 'Nova fonte · Tactia Ops' };

export default async function NewDataSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireOperator(`/tenants/${id}/data-sources/new`);
  const detail = await backofficeService.getTenant(ctx, id).catch(() => null);
  if (!detail) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/tenants/${id}`} className="font-mono text-xs text-primary hover:underline">
          ← {detail.tenant.name}
        </Link>
        <PageHeader
          className="mt-2"
          title="Nova fonte de dados"
          description="Escolha o tipo de fonte. Cada conector tem uma tela própria de configuração."
        />
      </div>
      <SourceKindPicker tenantId={id} />
    </div>
  );
}
