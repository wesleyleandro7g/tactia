import { AppError, ErrorCode } from '../errors';

export const STORAGE_KINDS = ['document', 'image', 'audio', 'integration-artifact'] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const INTEGRATION_ARTIFACT_MAX_BYTES = 100 * 1024 * 1024;

export const ALLOWED_DOC_MIME = ['application/pdf', 'text/plain', 'text/markdown'] as const;
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_AUDIO_MIME = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg'] as const;

const TENANT_ID_RE = /^[a-zA-Z0-9-]+$/;
const EXT_RE = /^[a-z0-9]{1,12}$/;
const ID_RE = /^[a-zA-Z0-9-]+$/;

export type PutObjectInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

export type ObjectStorage = {
  put(input: PutObjectInput): Promise<{ key: string }>;
  get(key: string): Promise<{ body: Buffer; contentType: string }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
};

export type StorageKeyInput = {
  tenantId: string;
  kind: StorageKind;
  id: string;
  ext: string;
};

/**
 * Caller-built object key. Never a user-supplied path.
 * Format: `${tenantId}/${kind}/${id}.${ext}`
 */
export function storageKey(input: StorageKeyInput): string {
  if (!TENANT_ID_RE.test(input.tenantId) || input.tenantId.includes('..')) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Tenant inválido.');
  }
  if (!STORAGE_KINDS.includes(input.kind)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Tipo de objeto inválido.');
  }
  if (!ID_RE.test(input.id) || input.id.includes('..')) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Identificador de objeto inválido.');
  }
  const ext = input.ext.replace(/^\./, '').toLowerCase();
  if (!EXT_RE.test(ext) || ext.includes('..')) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Extensão de arquivo inválida.');
  }
  const key = `${input.tenantId}/${input.kind}/${input.id}.${ext}`;
  assertSafeStorageKey(key);
  return key;
}

export function assertSafeStorageKey(key: string): string {
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Chave de armazenamento inválida.');
  }
  const parts = key.split('/');
  if (parts.length !== 3) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Chave de armazenamento inválida.');
  }
  const [tenantId, kind, file] = parts as [string, string, string];
  if (!TENANT_ID_RE.test(tenantId) || !STORAGE_KINDS.includes(kind as StorageKind)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Chave de armazenamento inválida.');
  }
  const dot = file.lastIndexOf('.');
  if (dot <= 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Chave de armazenamento inválida.');
  }
  const id = file.slice(0, dot);
  const ext = file.slice(dot + 1);
  if (!ID_RE.test(id) || !EXT_RE.test(ext)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Chave de armazenamento inválida.');
  }
  return key;
}

export function extFromFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? 'bin';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'bin';
  const ext = base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext.length > 0 ? ext : 'bin';
}

export function mimeKind(mime: string): StorageKind | 'csv' | null {
  if ((ALLOWED_DOC_MIME as readonly string[]).includes(mime)) return 'document';
  if ((ALLOWED_IMAGE_MIME as readonly string[]).includes(mime)) return 'image';
  if ((ALLOWED_AUDIO_MIME as readonly string[]).includes(mime)) return 'audio';
  if (mime === 'text/csv') return 'csv';
  return null;
}

export function maxBytesForKind(kind: StorageKind): number {
  if (kind === 'audio') return AUDIO_MAX_BYTES;
  if (kind === 'image') return IMAGE_MAX_BYTES;
  if (kind === 'integration-artifact') return INTEGRATION_ARTIFACT_MAX_BYTES;
  return DOCUMENT_MAX_BYTES;
}
