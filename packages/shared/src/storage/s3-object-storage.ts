import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AppError, ErrorCode } from '../errors';
import {
  assertSafeStorageKey,
  type ObjectStorage,
  type PutObjectInput,
} from './object-storage';

export type S3ObjectStorageConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
  client?: S3Client;
};

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3ObjectStorageConfig) {
    this.bucket = config.bucket;
    this.client =
      config.client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        forcePathStyle: config.forcePathStyle ?? true,
      });
  }

  async put(input: PutObjectInput): Promise<{ key: string }> {
    const key = assertSafeStorageKey(input.key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return { key };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const safe = assertSafeStorageKey(key);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: safe }),
      );
      const bytes = response.Body ? await response.Body.transformToByteArray() : new Uint8Array();
      return {
        body: Buffer.from(bytes),
        contentType: response.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      if (isNotFound(error)) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Objeto não encontrado.');
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const safe = assertSafeStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safe }));
  }

  async exists(key: string): Promise<boolean> {
    const safe = assertSafeStorageKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: safe }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return record.name === 'NotFound' || record.name === 'NoSuchKey' || record.$metadata?.httpStatusCode === 404;
}
