import { prisma } from '@tactia/database';
import { hasMinRole } from '@tactia/domain';
import { ConnectionsSettings } from '@/components/app/connections-settings';
import { requireTenant } from '@/lib/server-context';

export const metadata = { title: 'Conexões · Tactia' };

export default async function ConnectionsSettingsPage() {
  const ctx = await requireTenant('/settings/connections');
  const domainUser = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { externalAuthId: true },
  });
  const canManageCompany = hasMinRole(ctx.role, 'admin');
  const consents = await prisma.oauthConsent.findMany({
    where: {
      referenceId: ctx.tenantId,
      ...(canManageCompany ? {} : { userId: domainUser.externalAuthId }),
    },
    include: {
      client: { select: { name: true, uri: true, metadata: true } },
      user: { select: { name: true, email: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <ConnectionsSettings
      canManageCompany={canManageCompany}
      connections={consents.map((consent) => ({
        id: consent.id,
        clientName: consent.client.name || clientNameFromMetadata(consent.client.metadata),
        clientUri: consent.client.uri,
        userName: consent.user?.name ?? 'Usuário removido',
        userEmail: consent.user?.email ?? null,
        scopes: consent.scopes,
        connectedAt: (consent.updatedAt ?? consent.createdAt ?? new Date(0)).toISOString(),
      }))}
    />
  );
}

function clientNameFromMetadata(metadata: unknown): string {
  if (metadata && typeof metadata === 'object' && 'client_name' in metadata) {
    const name = (metadata as { client_name?: unknown }).client_name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return 'Aplicativo MCP';
}
