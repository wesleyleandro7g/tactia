import { createHash } from 'node:crypto';
import { prisma } from '@tactia/database';
import { AppError, ErrorCode } from '@tactia/shared';

function selectionKey(sessionId: string, query: URLSearchParams): string {
  const fields = ['client_id', 'code_challenge', 'redirect_uri', 'state'];
  if (!query.get('client_id') || !query.get('code_challenge')) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Fluxo OAuth inválido. Reinicie a conexão.');
  }
  return `mcp-company:${createHash('sha256')
    .update(JSON.stringify([sessionId, ...fields.map((field) => query.get(field))]))
    .digest('hex')}`;
}

/** One immutable company selection per PKCE flow, isolated from other tabs. */
export async function selectMcpCompany(sessionId: string, query: URLSearchParams, tenantId: string) {
  const id = selectionKey(sessionId, query);
  const selection = await prisma.authVerification.upsert({
    where: { id },
    create: { id, identifier: id, value: tenantId, expiresAt: new Date(Date.now() + 10 * 60_000) },
    update: {},
  });
  if (selection.value !== tenantId || selection.expiresAt <= new Date()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'A seleção expirou ou mudou. Reinicie a conexão.');
  }
}

export async function getMcpCompany(sessionId: string, query: URLSearchParams): Promise<string | null> {
  const selection = await prisma.authVerification.findUnique({ where: { id: selectionKey(sessionId, query) } });
  return selection && selection.expiresAt > new Date() ? selection.value : null;
}
