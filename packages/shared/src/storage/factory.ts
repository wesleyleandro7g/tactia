import { AppError, ErrorCode } from '../errors';
import { LocalObjectStorage, resolveUploadRoot } from './local-object-storage';
import type { ObjectStorage } from './object-storage';
import { S3ObjectStorage } from './s3-object-storage';

export type ObjectStorageEnv = {
  OBJECT_STORAGE?: string;
  UPLOAD_DIR?: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_FORCE_PATH_STYLE?: string;
};

/**
 * Local when `OBJECT_STORAGE=local` or `S3_ENDPOINT` is empty.
 * S3 when endpoint + access/secret/bucket are present.
 */
export function createObjectStorageFromEnv(env: ObjectStorageEnv = {}): ObjectStorage {
  const source: ObjectStorageEnv = {
    OBJECT_STORAGE: process.env.OBJECT_STORAGE,
    UPLOAD_DIR: process.env.UPLOAD_DIR,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
    S3_SECRET_KEY: process.env.S3_SECRET_KEY,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
    ...env,
  };
  const mode = source.OBJECT_STORAGE?.trim().toLowerCase();
  const endpoint = source.S3_ENDPOINT?.trim();

  if (mode === 'local' || !endpoint) {
    return new LocalObjectStorage(resolveUploadRoot(source.UPLOAD_DIR));
  }

  const accessKeyId = source.S3_ACCESS_KEY?.trim();
  const secretAccessKey = source.S3_SECRET_KEY?.trim();
  const bucket = source.S3_BUCKET?.trim();
  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      'Object storage S3 requires S3_ACCESS_KEY, S3_SECRET_KEY and S3_BUCKET.',
    );
  }

  return new S3ObjectStorage({
    endpoint,
    region: source.S3_REGION?.trim() || 'us-east-1',
    accessKeyId,
    secretAccessKey,
    bucket,
    forcePathStyle: source.S3_FORCE_PATH_STYLE !== 'false',
  });
}
