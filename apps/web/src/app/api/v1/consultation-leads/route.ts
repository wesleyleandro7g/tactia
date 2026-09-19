import { prisma } from '@tactia/database';
import { AcquisitionLeadService } from '@tactia/domain';
import { AppError, ErrorCode } from '@tactia/shared';
import { createApiHandler } from '@/lib/api';

const service = new AcquisitionLeadService(prisma);

export const POST = createApiHandler(
  { auth: 'none', rateLimit: { name: 'acquisition', limit: 5, windowMs: 600_000 } },
  async (request) => {
    // Enforce the actual stream size, not a client-provided Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Formulário vazio.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16_384) {
          await reader.cancel();
          throw new AppError(ErrorCode.VALIDATION_ERROR, 'Formulário muito grande.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Formulário inválido.');
    }
    return service.captureConsultation(body);
  },
);
