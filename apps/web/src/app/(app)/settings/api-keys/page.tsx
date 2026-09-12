import { ApiKeysSettings } from '@/components/app/api-keys-settings';
import { requireTenant } from '@/lib/server-context';
import { tenantApiKeyService } from '@/lib/services';
import { hasMinRole } from '@tactia/domain';
import { redirect } from 'next/navigation';

export const metadata = { title: 'API keys · Tactia' };

export default async function ApiKeysSettingsPage() {
  const ctx = await requireTenant('/settings/api-keys');
  if (!hasMinRole(ctx.role, 'admin')) redirect('/dashboard');
  const keys = await tenantApiKeyService.list(ctx);
  return (
    <ApiKeysSettings
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
  );
}
