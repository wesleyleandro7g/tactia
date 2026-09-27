import { AppError, AUDIO_MAX_BYTES, ErrorCode } from '@tactia/shared';
import { createApiHandler } from '@/lib/api';
import { uploadTenantMedia } from '@/lib/tenant-documents';

export const runtime = 'nodejs';

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
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
  return uploadTenantMedia(ctx, params['id']!, { purpose, file });
});
