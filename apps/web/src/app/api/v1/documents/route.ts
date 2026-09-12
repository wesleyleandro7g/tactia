import { AppError, DOCUMENT_MAX_BYTES, ErrorCode, REQUEST_ID_HEADER, ok } from '@tactia/shared';
import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { knowledgeDocumentService } from '@/lib/services';

export const runtime = 'nodejs';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return knowledgeDocumentService.list(ctx, searchParamsRecord(request));
});

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'], rateLimit: RATE_LIMITS.upload },
  async (request, ctx) => {
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
    const result = await knowledgeDocumentService.createFromUpload(ctx, { title, kind, file });
    if (result.reused) {
      return Response.json(ok(result.document, ctx.requestId), {
        status: 200,
        headers: { [REQUEST_ID_HEADER]: ctx.requestId },
      });
    }
    return result.document;
  },
);
