import { notFound } from 'next/navigation';
import { DocumentsSettings } from '@/components/app/documents-settings';
import { TabSection } from '@/components/app/tab-section';
import { listTenantDocuments } from '@/lib/tenant-documents';
import { loadOperator } from '@/lib/tenant-loaders';
import { ErrorCode, isAppError } from '@tactia/shared';

export const metadata = { title: 'Documentos · Empresa · Tactia Ops' };

export default async function TenantDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await loadOperator(id);

  let data: Awaited<ReturnType<typeof listTenantDocuments>>;
  try {
    data = await listTenantDocuments(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  }

  return (
    <TabSection title="Documentos">
      <p className="text-sm text-muted-foreground">
        Base de conhecimento da empresa: documentos (PDF/TXT/Markdown) e mídia (imagem/áudio) que a
        Tactia usa como contexto no chat.
      </p>
      <DocumentsSettings
        documentsBasePath={`/api/v1/tenants/${id}/documents`}
        mediaBasePath={`/api/v1/tenants/${id}/media`}
        documents={data.documents.items.map((document) => ({
          id: document.id,
          title: document.title,
          kind: document.kind,
          mime: document.mime,
          status: document.status,
          error: document.error,
          createdAt: document.createdAt.toISOString(),
        }))}
        media={data.media.items.map((item) => ({
          id: item.id,
          mime: item.mime,
          status: item.status,
          error: item.error,
          classification: item.classification,
          resultKind: item.resultKind,
          createdAt: item.createdAt.toISOString(),
        }))}
        pendingMapping={data.pending.items.map((item) => ({
          id: item.id,
          entityType: item.entityType,
          hint: item.hint,
        }))}
      />
    </TabSection>
  );
}
