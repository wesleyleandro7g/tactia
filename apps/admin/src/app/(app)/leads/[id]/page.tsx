import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ACQUISITION_STATUSES } from '@tactia/shared/acquisition';
import { isAppError, ErrorCode } from '@tactia/shared';
import { requireOperator } from '@/lib/server-context';
import { acquisitionLeadService } from '@/lib/acquisition';
import { PageHeader } from '@/components/app/page-header';
import { LeadStatusForm } from '@/components/app/lead-status-form';

export const metadata = { title: 'Detalhes do lead · Tactia Ops' };
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireOperator('/leads');
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const lead = await acquisitionLeadService.get(ctx, id).catch((error) => {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  });
  const fields = [
    ['Origem', lead.source === 'landing' ? 'LP de consultoria' : 'Site do produto'],
    ['Campanha', lead.attribution ? JSON.stringify(lead.attribution, null, 2) : 'Não informado'],
    ['Nome', lead.name],
    ['E-mail', lead.email],
    ['WhatsApp', lead.whatsapp],
    ['Telefone alternativo', lead.phone || 'Não informado'],
    ['Empresa', lead.company],
    ['Segmento', (lead.segment === 'Outros' ? lead.segmentOther : lead.segment) || 'Não informado'],
    ['Funcionários', lead.employeeRange || 'Não informado'],
    ['Faturamento médio mensal', lead.revenueRange || 'Não informado'],
    ['Ferramentas', lead.systems.join(', ') || 'Não informado'],
    ['Nomes dos sistemas', lead.systemDetails || 'Não informado'],
    ['Contexto da consultoria', lead.context || 'Não informado'],
    ['Recebido em', lead.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })],
  ];
  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/leads" className="text-sm text-primary">
        ← Leads
      </Link>
      <PageHeader title={lead.company} description={ACQUISITION_STATUSES[lead.status]} />
      <dl className="grid gap-6 rounded-lg border p-6 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className={label === 'Contexto da consultoria' ? 'sm:col-span-2' : ''}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      {lead.tenantId ? (
        <Link
          href={'/tenants/' + lead.tenantId}
          className="inline-flex rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground"
        >
          Ver empresa cadastrada
        </Link>
      ) : (
        <>
          <LeadStatusForm id={lead.id} initialStatus={lead.status} />
          <div className="border-t pt-6">
            <Link
              href={'/tenants/new?leadId=' + lead.id}
              className="inline-flex rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground"
            >
              Cadastrar cliente
            </Link>
            <p className="mt-2 text-xs text-muted-foreground">
              Revise os dados e defina o acesso antes de concluir.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
