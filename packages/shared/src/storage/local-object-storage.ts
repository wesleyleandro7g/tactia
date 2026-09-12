import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, ErrorCode } from '../errors';
import {
  assertSafeStorageKey,
  type ObjectStorage,
  type PutObjectInput,
} from './object-storage';

export const DEFAULT_UPLOAD_DIR = '/tmp/tactia-uploads';

export function resolveUploadRoot(dir?: string | null): string {
  const value = dir && dir.trim().length > 0 ? dir : DEFAULT_UPLOAD_DIR;
  return path.resolve(value);
}

export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolveUploadRoot(root);
  }

  async put(input: PutObjectInput): Promise<{ key: string }> {
    const key = assertSafeStorageKey(input.key);
    const dest = this.resolveKey(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, input.body);
    await writeFile(`${dest}.meta`, input.contentType, 'utf8');
    return { key };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const dest = this.resolveKey(assertSafeStorageKey(key));
    try {
      const body = await readFile(dest);
      let contentType = 'application/octet-stream';
      try {
        contentType = (await readFile(`${dest}.meta`, 'utf8')).trim() || contentType;
      } catch {
        // older objects without sidecar
      }
      return { body, contentType };
    } catch {
      throw new AppError(ErrorCode.NOT_FOUND, 'Objeto não encontrado.');
    }
  }

  async delete(key: string): Promise<void> {
    const dest = this.resolveKey(assertSafeStorageKey(key));
    await unlink(dest).catch(() => undefined);
    await unlink(`${dest}.meta`).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    const dest = this.resolveKey(assertSafeStorageKey(key));
    try {
      await access(dest);
      return true;
    } catch {
      return false;
    }
  }

  private resolveKey(key: string): string {
    const dest = path.resolve(this.root, key);
    const relative = path.relative(this.root, dest);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Chave de armazenamento inválida.');
    }
    return dest;
  }
}
