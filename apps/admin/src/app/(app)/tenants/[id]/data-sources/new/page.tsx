import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SourceKindPicker } from '@/components/app/source-kind-picker';
import { PageHeader } from '@/components/app/page-header';
import { requireOperator } from '@/lib/server-context';
import { backofficeService } from '@/lib/services';
import { ErrorCode, isAppError, type RequestContext } from '@tactia/shared';

export const metadata = { title: 'Nova fonte · Tactia Ops' };

async function loadTenant(ctx: RequestContext, id: string) {
  try {
    return await backofficeService.getTenant(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  }
}

export default async function NewDataSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireOperator(`/tenants/${id}/data-sources/new`);
  const detail = await loadTenant(ctx, id);

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
