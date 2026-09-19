import Link from 'next/link';
import { ACQUISITION_STATUSES } from '@tactia/shared/acquisition';
import { requireOperator } from '@/lib/server-context';
import { acquisitionLeadService } from '@/lib/acquisition';
import { PageHeader } from '@/components/app/page-header';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Leads · Tactia Ops' };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { ctx } = await requireOperator('/leads');
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.slice(0, 120) : '';
  const status =
    typeof params.status === 'string' && Object.hasOwn(ACQUISITION_STATUSES, params.status)
      ? params.status
      : '';
  const page = Math.min(100000, Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1));
  const result = await acquisitionLeadService.list(ctx, { q, status, page });
  const pageLink = (value: number) =>
    '/leads?' + new URLSearchParams({ q, status, page: String(value) });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Conversas que podem transformar novas operações. Acompanhe os contatos da consultoria gratuita."
      />
      <form className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="mb-2 block text-sm">
            Nome, e-mail ou empresa
          </label>
          <Input id="q" name="q" defaultValue={q} maxLength={120} />
        </div>
        <div>
          <label htmlFor="status" className="mb-2 block text-sm">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {Object.entries(ACQUISITION_STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Filtrar</Button>
      </form>
      <p className="text-sm text-muted-foreground">{result.total} contato(s)</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              {['Contato', 'Empresa', 'Origem', 'Status', 'Recebido em'].map((label) => (
                <th key={label} scope="col" className="p-4 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.items.map((lead) => (
              <tr key={lead.id} className="border-t">
                <td className="p-4">
                  <Link
                    href={'/leads/' + lead.id}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {lead.name}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">{lead.email}</p>
                </td>
                <td className="p-4">{lead.company}</td>
                <td className="p-4">
                  {lead.source === 'landing' ? 'LP de consultoria' : 'Site do produto'}
                </td>
                <td className="p-4">{ACQUISITION_STATUSES[lead.status]}</td>
                <td className="whitespace-nowrap p-4">
                  {lead.createdAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!result.items.length && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nenhum lead encontrado. Os novos contatos aparecerão aqui.
          </p>
        )}
      </div>
      <nav aria-label="Paginação" className="flex items-center justify-between text-sm">
        {page > 1 ? (
          <Link href={pageLink(page - 1)} className="text-primary">
            Anterior
          </Link>
        ) : (
          <span />
        )}
        <span>
          Página {page} de {Math.max(1, Math.ceil(result.total / 20))}
        </span>
        {page * 20 < result.total ? (
          <Link href={pageLink(page + 1)} className="text-primary">
            Próxima
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
