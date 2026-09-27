import { notFound } from 'next/navigation';
import { ApiKeysSettings } from '@/components/app/api-keys-settings';
import { TabSection } from '@/components/app/tab-section';
import { listTenantApiKeys } from '@/lib/tenant-api-keys';
import { loadOperator } from '@/lib/tenant-loaders';
import { ErrorCode, isAppError } from '@tactia/shared';

export const metadata = { title: 'API keys · Empresa · Tactia Ops' };

export default async function TenantApiKeysPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await loadOperator(id);

  let keys: Awaited<ReturnType<typeof listTenantApiKeys>>['keys'];
  let owners: Awaited<ReturnType<typeof listTenantApiKeys>>['owners'];
  try {
    ({ keys, owners } = await listTenantApiKeys(ctx, id));
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  }

  return (
    <TabSection title="API keys">
      <p className="text-sm text-muted-foreground">
        Emita chaves MCP para esta empresa. A chave executa as mesmas tools do chat, com o tenant
        congelado, em nome do owner/admin selecionado. O secret aparece apenas uma vez.
      </p>
      <ApiKeysSettings
        apiBasePath={`/api/v1/tenants/${id}/api-keys`}
        owners={owners}
        keys={keys.map((key) => ({
          id: key.id,
          name: key.name,
          prefix: key.prefix,
          scopes: key.scopes,
          role: key.role,
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
          revokedAt: key.revokedAt?.toISOString() ?? null,
          createdAt: key.createdAt.toISOString(),
        }))}
      />
    </TabSection>
  );
}
