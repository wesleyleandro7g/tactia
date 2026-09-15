import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, ErrorCode } from './errors';
import { createId } from './uuid';

export const CSV_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const DEFAULT_UPLOAD_DIR = '/tmp/tactia-uploads';

export function isCsvFile(file: { name: string; type?: string }): boolean {
  return file.name.toLowerCase().endsWith('.csv');
}

export function uploadRoot(dir = process.env['UPLOAD_DIR']): string {
  return path.resolve(dir && dir.trim().length > 0 ? dir : DEFAULT_UPLOAD_DIR);
}

function assertSafeTenantId(tenantId: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(tenantId)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Tenant inválido.');
  }
  return tenantId;
}

/**
 * Persiste um CSV em disco no diretório do tenant. O nome original não entra
 * no path (evita traversal); só volta na resposta para a UI.
 */
export async function saveCsvUpload(
  tenantId: string,
  file: File,
  dir = process.env['UPLOAD_DIR'],
): Promise<{ filePath: string; fileName: string; size: number }> {
  if (!(file instanceof File) || file.size === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Envie um arquivo CSV.');
  }
  if (file.size > CSV_MAX_UPLOAD_BYTES) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'O arquivo pode ter no máximo 20 MB.');
  }
  if (!isCsvFile(file)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Apenas arquivos CSV são aceitos.');
  }

  const safeTenant = assertSafeTenantId(tenantId);
  const root = uploadRoot(dir);
  const destDir = path.join(root, safeTenant);
  const destPath = path.resolve(destDir, `${createId()}.csv`);
  const relative = path.relative(root, destPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Caminho de upload inválido.');
  }

  await mkdir(destDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(destPath, buffer);

  return {
    filePath: destPath,
    fileName: path.basename(file.name),
    size: buffer.length,
  };
}
