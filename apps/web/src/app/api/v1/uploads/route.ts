import { AppError, ErrorCode } from '@tactia/shared';
import { createApiHandler } from '@/lib/api';
import { MAX_UPLOAD_BYTES, saveCsvUpload } from '@/lib/csv-upload';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * POST /api/v1/uploads
 * multipart/form-data, campo `file`.
 *
 * Grava o CSV em disco e devolve o `filePath` que o CsvConnector já sabe ler.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'], rateLimit: RATE_LIMITS.upload },
  async (request, ctx) => {
    const length = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES + 1024 * 1024) {
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

    return saveCsvUpload(ctx.tenantId!, file);
  },
);
