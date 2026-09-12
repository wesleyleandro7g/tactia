import { DocumentsSettings } from '@/components/app/documents-settings';
import { requireTenant } from '@/lib/server-context';
import { knowledgeDocumentService, mediaIngestService } from '@/lib/services';
import { hasMinRole } from '@tactia/domain';

export const metadata = { title: 'Documentos · Tactia' };

export default async function DocumentsSettingsPage() {
  const ctx = await requireTenant('/settings/documents');
  const [documents, media] = await Promise.all([
    knowledgeDocumentService.list(ctx, { page: '1', pageSize: '50' }),
    mediaIngestService.list(ctx, { page: '1', pageSize: '50' }),
  ]);
  const pending = await mediaIngestService.listPendingMapping(ctx);

  return (
    <DocumentsSettings
      canWrite={hasMinRole(ctx.role, 'member')}
      documents={documents.items.map((document) => ({
        id: document.id,
        title: document.title,
        kind: document.kind,
        mime: document.mime,
        status: document.status,
        error: document.error,
        createdAt: document.createdAt.toISOString(),
      }))}
      media={media.items.map((item) => ({
        id: item.id,
        mime: item.mime,
        status: item.status,
        error: item.error,
        classification: item.classification,
        resultKind: item.resultKind,
        createdAt: item.createdAt.toISOString(),
      }))}
      pendingMapping={pending.items.map((item) => ({
        id: item.id,
        entityType: item.entityType,
        hint: item.hint,
      }))}
    />
  );
}
