import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../errors';
import { createObjectStorageFromEnv } from './factory';
import { LocalObjectStorage } from './local-object-storage';
import { S3ObjectStorage } from './s3-object-storage';
import { storageKey } from './object-storage';

describe('ObjectStorage', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('E16: local storage put get delete roundtrip', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tactia-storage-'));
    const storage = new LocalObjectStorage(dir);
    const key = storageKey({
      tenantId: 'tenant-1',
      kind: 'document',
      id: '11111111-1111-4111-8111-111111111111',
      ext: 'pdf',
    });
    const body = Buffer.from('hello-tactia');
    await storage.put({ key, body, contentType: 'application/pdf' });
    expect(await storage.exists(key)).toBe(true);
    const got = await storage.get(key);
    expect(got.body.equals(body)).toBe(true);
    expect(got.contentType).toBe('application/pdf');
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.get(key)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('E16: storageKey rejects path traversal', () => {
    expect(() =>
      storageKey({ tenantId: '../etc', kind: 'document', id: 'abc', ext: 'pdf' }),
    ).toThrow();
    expect(() =>
      storageKey({ tenantId: 'tenant-1', kind: 'document', id: '..', ext: 'pdf' }),
    ).toThrow();
    expect(() =>
      storageKey({ tenantId: 'tenant-1', kind: 'document', id: 'abc/../x', ext: 'pdf' }),
    ).toThrow();
    expect(() =>
      storageKey({ tenantId: 'tenant-1', kind: 'document', id: 'abc', ext: '../pdf' }),
    ).toThrow();
    expect(
      storageKey({
        tenantId: 'tenant-1',
        kind: 'image',
        id: '22222222-2222-4222-8222-222222222222',
        ext: 'png',
      }),
    ).toBe('tenant-1/image/22222222-2222-4222-8222-222222222222.png');
  });

  it('factory uses local when OBJECT_STORAGE=local even with S3_ENDPOINT', () => {
    const storage = createObjectStorageFromEnv({
      OBJECT_STORAGE: 'local',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_ACCESS_KEY: 'x',
      S3_SECRET_KEY: 'y',
      S3_BUCKET: 'tactia',
      UPLOAD_DIR: '/tmp/tactia-uploads-test',
    });
    expect(storage).toBeInstanceOf(LocalObjectStorage);
  });

  it('factory uses local when S3_ENDPOINT is empty', () => {
    const storage = createObjectStorageFromEnv({ OBJECT_STORAGE: undefined, S3_ENDPOINT: '' });
    expect(storage).toBeInstanceOf(LocalObjectStorage);
  });

  it('S3 driver sends PutObject with forcePathStyle from env keys', async () => {
    const send = vi.fn(async (_command: { input: { Bucket: string; Key: string } }) => ({}));
    const storage = new S3ObjectStorage({
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKeyId: 'tactia',
      secretAccessKey: 'secret',
      bucket: 'tactia',
      forcePathStyle: true,
      client: { send } as never,
    });
    const key = storageKey({
      tenantId: 'tenant-1',
      kind: 'audio',
      id: '33333333-3333-4333-8333-333333333333',
      ext: 'ogg',
    });
    await storage.put({ key, body: Buffer.from('wav'), contentType: 'audio/ogg' });
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0];
    expect(command?.input.Bucket).toBe('tactia');
    expect(command?.input.Key).toBe(key);
  });
});
