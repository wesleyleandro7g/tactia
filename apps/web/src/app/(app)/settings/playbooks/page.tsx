import { PlaybooksSettings } from '@/components/app/playbooks-settings';
import { requireTenant } from '@/lib/server-context';
import { playbookService } from '@/lib/services';

export const metadata = { title: 'Playbooks · Tactia' };

export default async function PlaybooksSettingsPage() {
  const ctx = await requireTenant('/settings/playbooks');
  const { items } = await playbookService.list(ctx);
  return (
    <PlaybooksSettings
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
  );
}
