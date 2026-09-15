import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConnectDataSourceForm } from '@/components/app/connect-data-source-form';
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
          description="Registre de onde vêm os dados desta empresa. Conectores (CSV, PostgreSQL, MCP) podem ser testados e sincronizados; as demais fontes ficam registradas até o conector existir."
        />
      </div>
      <ConnectDataSourceForm tenantId={id} />
    </div>
  );
}
