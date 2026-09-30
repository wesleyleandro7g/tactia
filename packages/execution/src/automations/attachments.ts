import { AppError, ErrorCode } from '@tactia/shared';
import type { PrismaClient } from '@tactia/database';
import type { EmailAttachment } from '../types';

const ALLOWED_MIME = new Set(['text/csv', 'application/csv', 'text/plain']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

export async function loadAutomationAttachments(input: {
  db: PrismaClient;
  storage: { get(key: string): Promise<{ body: Buffer; contentType: string }> };
  tenantId: string;
  artifactIds: string[];
}): Promise<EmailAttachment[]> {
  const attachments: EmailAttachment[] = [];
  let total = 0;
  for (const artifactId of input.artifactIds) {
    const artifact = await input.db.automationArtifact.findFirst({
      where: { id: artifactId, tenantId: input.tenantId },
    });
    if (!artifact || !artifact.storageKey.startsWith(`${input.tenantId}/`)) {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Anexo fora do escopo da empresa.');
    }
    const mime = artifact.mime.split(';')[0]?.trim() ?? '';
    if (!ALLOWED_MIME.has(mime)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Tipo de arquivo não permitido: ${artifact.name}.`);
    }
    if (artifact.byteSize > MAX_FILE_BYTES) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Arquivo acima do limite: ${artifact.name}.`);
    }
    total += artifact.byteSize;
    if (total > MAX_TOTAL_BYTES) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Os anexos passam do tamanho permitido para e-mail.');
    }
    const object = await input.storage.get(artifact.storageKey);
    attachments.push({ filename: artifact.name, content: object.body, contentType: mime });
  }
  return attachments;
}
