import Link from 'next/link';
import { PageHeader } from '@/components/app/page-header';
import { ProvisionTenantForm } from '@/components/app/provision-tenant-form';
import { requireOperator } from '@/lib/server-context';
import { acquisitionLeadService } from '@/lib/acquisition';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { isAppError, ErrorCode } from '@tactia/shared';

export const metadata = { title: 'Nova empresa · Tactia Ops' };

export default async function NewTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  const { ctx } = await requireOperator('/tenants/new');
  const { leadId } = await searchParams;
  if (leadId && !z.string().uuid().safeParse(leadId).success) notFound();
  const lead = leadId
    ? await acquisitionLeadService.get(ctx, leadId).catch((error) => {
        if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
        throw error;
      })
    : undefined;
  if (lead?.tenantId) redirect('/tenants/' + lead.tenantId);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="font-mono text-xs text-primary hover:underline">
          ← Empresas
        </Link>
        <PageHeader
          className="mt-2"
          title="Provisionar empresa"
          description="Cria o tenant e o usuário owner. A senha provisória deve ir por outro canal — não há e-mail de convite."
        />
      </div>
      <ProvisionTenantForm
        lead={
          lead
            ? { id: lead.id, company: lead.company, name: lead.name, email: lead.email }
            : undefined
        }
      />
    </div>
  );
}
