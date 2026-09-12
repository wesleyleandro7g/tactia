import { AppError, AUDIO_MAX_BYTES, ErrorCode } from '@tactia/shared';
import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { mediaIngestService } from '@/lib/services';

export const runtime = 'nodejs';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  const query = searchParamsRecord(request);
  const [list, pending] = await Promise.all([
    mediaIngestService.list(ctx, query),
    mediaIngestService.listPendingMapping(ctx),
  ]);
  return { ...list, pendingMapping: pending.items };
});

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'], rateLimit: RATE_LIMITS.upload },
  async (request, ctx) => {
    const length = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(length) && length > AUDIO_MAX_BYTES + 1024 * 1024) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'O arquivo excede o tamanho máximo.');
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

    const purpose = String(form.get('purpose') ?? 'auto').trim() || 'auto';
    return mediaIngestService.createFromUpload(ctx, { purpose, file });
  },
);
