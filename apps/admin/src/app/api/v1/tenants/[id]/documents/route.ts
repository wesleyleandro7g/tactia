import { AppError, DOCUMENT_MAX_BYTES, ErrorCode, REQUEST_ID_HEADER, ok } from '@tactia/shared';
import { createApiHandler } from '@/lib/api';
import { listTenantDocuments, uploadTenantDocument } from '@/lib/tenant-documents';

export const runtime = 'nodejs';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  const { documents, media, pending } = await listTenantDocuments(ctx, params['id']!);
  return { documents, media, pendingMapping: pending.items };
});

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > DOCUMENT_MAX_BYTES + 1024 * 1024) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'O arquivo pode ter no máximo 20 MB.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Envie o arquivo como multipart/form-data.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Envie um arquivo no campo file.');
  }

  const title = String(form.get('title') ?? '').trim() || undefined;
  const kind = String(form.get('kind') ?? '').trim() || undefined;
  const result = await uploadTenantDocument(ctx, params['id']!, { title, kind, file });
  if (result.reused) {
    return Response.json(ok(result.document, ctx.requestId), {
      status: 200,
      headers: { [REQUEST_ID_HEADER]: ctx.requestId },
    });
  }
  return result.document;
});
