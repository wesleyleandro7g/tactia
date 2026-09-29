import Link from 'next/link';
import { prisma } from '@tactia/database';
import { EvidenceGapQueue, type ClarificationContact, type EvidenceGapQueueItem } from '@/components/app/evidence-gap-queue';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requireOperator } from '@/lib/server-context';
import { evidenceGapService } from '@/lib/services';

export const metadata = { title: 'Lacunas · Tactia Ops' };

export default async function GapsPage({ searchParams }: { searchParams: Promise<{ tenantId?: string; status?: string; impact?: string; page?: string }> }) {
  const { ctx } = await requireOperator('/gaps');
  const params = await searchParams;
  const result = await evidenceGapService.list(ctx, params);
  const items: EvidenceGapQueueItem[] = result.items.map((item) => {
    const clarification = item.clarifications[0];
    return ({ id: item.id, tenant: { id: item.tenant.id, name: item.tenant.name }, plan: item.plan ? { id: item.plan.id, title: item.plan.title } : null, subject: item.subject, reason: item.reason, impact: item.impact, status: item.status, attempts: item.attempts, assignee: item.assignee ? { id: item.assignee.id, name: item.assignee.name } : null, nextStep: item.nextStep, nextAttemptAllowedAt: item.nextAttemptAllowedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString(), clarification: clarification ? { id: clarification.id, status: clarification.status, question: clarification.question, contactLabel: clarification.number.contactName ?? clarification.number.label ?? 'Contato autorizado', sentAt: clarification.sentAt?.toISOString() ?? null, answeredAt: clarification.answeredAt?.toISOString() ?? null, error: clarification.error } : null });
  });
  const tenantIds = [...new Set(items.map((item) => item.tenant.id))];
  const numbers = tenantIds.length
    ? await prisma.whatsappAuthorizedNumber.findMany({
        where: { tenantId: { in: tenantIds }, disabledAt: null },
        select: { id: true, tenantId: true, contactName: true, label: true, phone: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const contacts: ClarificationContact[] = numbers.map((number) => ({
    id: number.id,
    tenantId: number.tenantId,
    label: number.contactName ?? number.label ?? number.phone,
  }));
  const page = result.page;
  const pageHref = (value: number) => `/gaps?${new URLSearchParams({ ...(params.tenantId ? { tenantId: params.tenantId } : {}), ...(params.status ? { status: params.status } : {}), ...(params.impact ? { impact: params.impact } : {}), page: String(value) })}`;
  return <div className="flex flex-col gap-6"><PageHeader title="Lacunas de evidência" description="Exceções por impacto, com responsável e próximo passo. O cliente recebe somente a limitação relevante, não a tarefa de investigar." /><form className="flex flex-wrap items-end gap-3"><div><label htmlFor="tenantId" className="mb-2 block font-mono text-xs uppercase text-muted-foreground">ID da empresa</label><Input id="tenantId" name="tenantId" defaultValue={params.tenantId ?? ''} placeholder="UUID opcional" /></div><div><label htmlFor="status" className="mb-2 block font-mono text-xs uppercase text-muted-foreground">Estado</label><select id="status" name="status" defaultValue={params.status ?? ''} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="">Todos</option><option value="new">Nova</option><option value="in_progress">Em tratamento</option><option value="waiting_source">Aguardando fonte</option><option value="waiting_response">Aguardando resposta</option><option value="resolved">Resolvida</option><option value="unresolved">Sem resolução</option></select></div><div><label htmlFor="impact" className="mb-2 block font-mono text-xs uppercase text-muted-foreground">Impacto</label><select id="impact" name="impact" defaultValue={params.impact ?? ''} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="">Todos</option><option value="critical">Crítico</option><option value="high">Alto</option><option value="medium">Médio</option><option value="low">Baixo</option></select></div><Button type="submit">Filtrar</Button></form><p className="font-mono text-xs text-muted-foreground">{result.total} lacuna(s)</p><EvidenceGapQueue items={items} contacts={contacts} /><nav aria-label="Paginação" className="flex justify-between text-sm">{page > 1 ? <Link href={pageHref(page - 1)} className="text-primary">Anterior</Link> : <span />}{page * result.pageSize < result.total ? <Link href={pageHref(page + 1)} className="text-primary">Próxima</Link> : <span />}</nav></div>;
}
