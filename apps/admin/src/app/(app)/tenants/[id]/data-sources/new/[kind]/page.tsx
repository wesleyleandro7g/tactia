import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSourceKind } from '@tactia/domain/data-sources/catalog';
import { ConnectSourceWizard } from '@/components/app/connect-source-wizard';
import { DatabaseConnectWizard } from '@/components/app/database-connect-wizard';
import { TrelloConnectWizard } from '@/components/app/trello-connect-wizard';
import { TorgeIntegrationWizard } from '@/components/app/torge-integration-wizard';
import { connectorScreenCopy } from '@/components/app/connector-steps';
import { PageHeader } from '@/components/app/page-header';
import { requireOperator } from '@/lib/server-context';
import { backofficeService } from '@/lib/services';
import { ErrorCode, isAppError, type RequestContext } from '@tactia/shared';

type PageProps = {
  params: Promise<{ id: string; kind: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function loadTenant(ctx: RequestContext, id: string) {
  try {
    return await backofficeService.getTenantHeader(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  }
}

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

export default async function NewDataSourceKindPage({ params, searchParams }: PageProps) {
  const [{ id, kind: kindId }, query] = await Promise.all([params, searchParams]);
  if (kindId === 'postgres') {
    redirect(`/tenants/${id}/data-sources/new/database`);
  }
  const kind = getSourceKind(kindId);
  if (!kind || !kind.selectable) notFound();

  const { ctx } = await requireOperator(`/tenants/${id}/data-sources/new/${kindId}`);
  const detail = await loadTenant(ctx, id);

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
      ) : kind.id === 'trello' ? (
        <TrelloConnectWizard
          tenantId={id}
          kind={kind}
          oauthCredentialId={typeof query['credentialId'] === 'string' ? query['credentialId'] : undefined}
          oauthStatus={typeof query['oauth'] === 'string' ? query['oauth'] : undefined}
          oauthReason={typeof query['reason'] === 'string' ? query['reason'] : undefined}
        />
      ) : kind.id === 'torge' ? (
        <TorgeIntegrationWizard tenantId={id} />
      ) : (
        <ConnectSourceWizard tenantId={id} kind={kind} />
      )}
    </div>
  );
}
