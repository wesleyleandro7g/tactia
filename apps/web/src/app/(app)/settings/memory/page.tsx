import { MemorySettings } from '@/components/app/memory-settings';
import { requireTenant } from '@/lib/server-context';
import { episodeService } from '@/lib/services';

export const metadata = { title: 'Memória · Tactia' };

export default async function MemorySettingsPage() {
  const ctx = await requireTenant('/settings/memory');
  const { items } = await episodeService.listRecent(ctx, 50);
  return (
    <MemorySettings
      episodes={items.map((episode) => ({
        id: episode.id,
        kind: episode.kind,
        outcome: episode.outcome,
        text: episode.text,
        occurredAt: episode.occurredAt.toISOString(),
        indexed: episode.embeddedAt != null,
      }))}
    />
  );
}
