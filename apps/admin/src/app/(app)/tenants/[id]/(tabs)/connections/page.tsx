import { notFound } from 'next/navigation';
import { ConnectionsSettings } from '@/components/app/connections-settings';
import { TabSection } from '@/components/app/tab-section';
import { listTenantConnections } from '@/lib/tenant-connections';
import { loadOperator } from '@/lib/tenant-loaders';
import { ErrorCode, isAppError } from '@tactia/shared';

export const metadata = { title: 'Conexões · Empresa · Tactia Ops' };

export default async function TenantConnectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await loadOperator(id);

  let connections: Awaited<ReturnType<typeof listTenantConnections>>;
  try {
    connections = await listTenantConnections(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  }

  return (
    <TabSection title="Conexões">
      <p className="text-sm text-muted-foreground">
        Aplicativos com acesso OAuth a esta empresa. A revogação bloqueia os tokens imediatamente.
      </p>
      <ConnectionsSettings apiBasePath={`/api/v1/tenants/${id}/connections`} connections={connections} />
    </TabSection>
  );
}
