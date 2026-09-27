import { TenantChat } from '@/components/app/tenant-chat';
import { adminLlmConfigured } from '@/lib/chat';
import { loadTenantHeader } from '@/lib/tenant-loaders';

export const metadata = { title: 'Chat · Empresa · Tactia Ops' };

/**
 * Test chat for the tenant (operators only, enforced by the (app) layout and
 * by every chat route). Fixed height so only the message list scrolls.
 */
export default async function TenantChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await loadTenantHeader(id);

  return (
    <div className="flex h-[calc(100svh-15rem)] min-h-[32rem] flex-col overflow-hidden rounded-lg border border-border bg-background">
      <TenantChat tenantId={tenant.id} tenantName={tenant.name} llmConfigured={adminLlmConfigured()} />
    </div>
  );
}
