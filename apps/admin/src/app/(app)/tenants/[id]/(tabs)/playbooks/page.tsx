import { notFound } from 'next/navigation';
import { PlaybooksSettings } from '@/components/app/playbooks-settings';
import { TabSection } from '@/components/app/tab-section';
import { listTenantPlaybooks } from '@/lib/tenant-playbooks';
import { loadOperator } from '@/lib/tenant-loaders';
import { ErrorCode, isAppError } from '@tactia/shared';

export const metadata = { title: 'Playbooks · Empresa · Tactia Ops' };

export default async function TenantPlaybooksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await loadOperator(id);

  let items: Awaited<ReturnType<typeof listTenantPlaybooks>>['items'];
  try {
    ({ items } = await listTenantPlaybooks(ctx, id));
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  }

  return (
    <TabSection title="Playbooks">
      <p className="text-sm text-muted-foreground">
        Procedimentos que a Tactia narra no chat. O assistente nunca executa um playbook sozinho.
      </p>
      <PlaybooksSettings
        apiBasePath={`/api/v1/tenants/${id}/playbooks`}
        playbooks={items.map((playbook) => ({
          id: playbook.id,
          slug: playbook.slug,
          title: playbook.title,
          trigger: playbook.trigger,
          steps: playbook.steps,
          enabled: playbook.enabled,
          indexed: playbook.indexed,
        }))}
      />
    </TabSection>
  );
}
