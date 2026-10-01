import { MemorySettings } from '@/components/app/memory-settings';
import { requireTenant } from '@/lib/server-context';
import { companyKnowledgeService, episodeService } from '@/lib/services';
import { prisma } from '@tactia/database';

export const metadata = { title: 'Memória · Tactia' };

export default async function MemorySettingsPage() {
  const ctx = await requireTenant('/settings/memory');
  const [{ items }, summaries] = await Promise.all([
    episodeService.listRecent(ctx, 50),
    companyKnowledgeService.listSummaries(ctx),
  ]);
  const authors = await prisma.user.findMany({
    where: { id: { in: [...new Set(summaries.map((summary) => summary.authorUserId))] } },
    select: { id: true, name: true },
  });
  const names = new Map(authors.map((author) => [author.id, author.name]));
  return (
    <MemorySettings
      canEdit={ctx.role === 'owner' || ctx.role === 'admin'}
      summaries={summaries.map((summary) => ({
        id: summary.id, text: summary.text, authorName: names.get(summary.authorUserId) ?? 'Membro da empresa',
        updatedAt: summary.updatedAt.toISOString(), reviewedAt: summary.reviewedAt?.toISOString() ?? null,
      }))}
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
