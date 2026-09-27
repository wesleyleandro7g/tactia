import type { RequestContext } from '@tactia/shared';
import { knowledgeDocumentService, mediaIngestService, scopedTenant } from './settings-services';

export async function listTenantDocuments(ctx: RequestContext, tenantId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  const [documents, media, pending] = await Promise.all([
    knowledgeDocumentService.list(scoped, { page: '1', pageSize: '50' }),
    mediaIngestService.list(scoped, { page: '1', pageSize: '50' }),
    mediaIngestService.listPendingMapping(scoped),
  ]);
  return { documents, media, pending };
}

export async function uploadTenantDocument(
  ctx: RequestContext,
  tenantId: string,
  input: { title?: string; kind?: string; file: File },
) {
  const scoped = await scopedTenant(ctx, tenantId);
  return knowledgeDocumentService.createFromUpload(scoped, input);
}

export async function uploadTenantMedia(
  ctx: RequestContext,
  tenantId: string,
  input: { purpose?: string; file: File },
) {
  const scoped = await scopedTenant(ctx, tenantId);
  return mediaIngestService.createFromUpload(scoped, input);
}

export async function removeTenantDocument(ctx: RequestContext, tenantId: string, documentId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  return knowledgeDocumentService.remove(scoped, documentId);
}
