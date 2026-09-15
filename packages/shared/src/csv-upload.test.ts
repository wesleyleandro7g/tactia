import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { isCsvFile, saveCsvUpload, uploadRoot } from './csv-upload';

const tenantId = '0199aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee';

describe('csv-upload', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('aceita apenas arquivos com extensão .csv', () => {
    expect(isCsvFile({ name: 'clientes.csv', type: 'application/octet-stream' })).toBe(true);
    expect(isCsvFile({ name: 'planilha.xlsx', type: 'text/csv' })).toBe(false);
    expect(isCsvFile({ name: 'foto.png', type: 'image/png' })).toBe(false);
  });

  it('resolve UPLOAD_DIR absoluto', () => {
    expect(uploadRoot('/data/uploads')).toBe(path.resolve('/data/uploads'));
    expect(uploadRoot('')).toBe(path.resolve('/tmp/tactia-uploads'));
  });

  it('grava o arquivo sob o tenant e ignora o nome original no path', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tactia-upload-'));
    const file = new File(['external_id,name\n1,Ana\n'], '../../evil.csv', { type: 'text/csv' });
    const result = await saveCsvUpload(tenantId, file, dir);

    expect(result.fileName).toBe('evil.csv');
    expect(result.size).toBeGreaterThan(0);
    expect(result.filePath.startsWith(path.join(dir, tenantId))).toBe(true);
    expect(result.filePath.endsWith('.csv')).toBe(true);
    expect(result.filePath.includes('..')).toBe(false);
    expect(await readFile(result.filePath, 'utf8')).toContain('Ana');
  });

  it('rejeita tenant com path traversal', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tactia-upload-'));
    const file = new File(['a,b\n'], 'a.csv', { type: 'text/csv' });
    await expect(saveCsvUpload('../etc', file, dir)).rejects.toBeInstanceOf(AppError);
  });

  it('rejeita arquivo vazio e não-csv', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tactia-upload-'));
    const empty = new File([], 'vazio.csv', { type: 'text/csv' });
    await expect(saveCsvUpload(tenantId, empty, dir)).rejects.toBeInstanceOf(AppError);

    const png = new File(['xxxx'], 'foto.png', { type: 'image/png' });
    await expect(saveCsvUpload(tenantId, png, dir)).rejects.toBeInstanceOf(AppError);
  });
});
