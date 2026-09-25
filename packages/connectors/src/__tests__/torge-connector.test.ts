import { describe, expect, it, vi } from 'vitest';
import type { RawRecordRepository } from '@tactia/database';
import type { BrowserExecutor } from '../browser/contracts';
import { TorgeConnector, type TorgeConnectionConfig } from '../providers/torge/torge-connector';

const config: TorgeConnectionConfig = {
  accountScope: 'empresa-sintetica',
  branchScope: 'filial-01',
  instanceKey: 'dedicated-test',
  enabledModules: ['products'],
  timezone: 'America/Sao_Paulo',
  dailyTime: '03:00',
  recentWindowDays: 30,
  reconciliationWindowDays: 30,
};

function browser(data: unknown): BrowserExecutor {
  return {
    engine: 'fake-browser',
    instanceKey: 'dedicated-test',
    health: async () => ({ healthy: true, safeMessage: 'ok' }),
    execute: async (request) => ({
      status: 'succeeded',
      externalExecutionId: request.executionKey,
      artifactRefs: [],
      data,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }),
    fetchArtifact: async () => { throw new Error('not used'); },
  };
}

function context() {
  return {
    tenantId: 'tenant-1',
    dataSourceId: 'source-1',
    syncJobId: 'job-1',
    mappings: [{
      sourceEntity: 'products',
      targetEntity: 'product',
      configuration: { fields: [{ source: 'external_id', target: 'external_id' }] },
    }],
  };
}

describe('TorgeConnector', () => {
  it('scopes stable identity by account and branch and reports completeness', async () => {
    const upsertByKey = vi.fn(async () => ({ created: true, record: { id: 'raw-1', checksum: 'x' } }));
    const connector = new TorgeConnector(
      'source-1',
      'credential-1',
      config,
      browser({ complete: true, sourceTotal: 1, rows: [{ external_id: '0001', name: 'Produto' }] }),
      { upsertByKey } as unknown as RawRecordRepository,
    );
    const result = await connector.sync(context());
    expect(result.moduleResults?.[0]).toMatchObject({ status: 'succeeded', recordsRead: 1 });
    expect(upsertByKey).toHaveBeenCalledWith(expect.objectContaining({
      externalId: 'empresa-sintetica|filial-01|0001',
      payload: expect.objectContaining({ external_id: 'empresa-sintetica|filial-01|0001' }),
    }));
  });

  it('does not publish an incomplete collection', async () => {
    const upsertByKey = vi.fn();
    const connector = new TorgeConnector(
      'source-1',
      'credential-1',
      config,
      browser({ complete: false, sourceTotal: 2, rows: [{ external_id: '1', name: 'Produto' }] }),
      { upsertByKey } as unknown as RawRecordRepository,
    );
    const result = await connector.sync(context());
    expect(result.moduleResults?.[0]).toMatchObject({ status: 'failed', recordsFailed: 1, retryable: false });
    expect(upsertByKey).not.toHaveBeenCalled();
  });

  it('rejects enabling pending modules without calling the executor', () => {
    expect(() => new TorgeConnector('source-1', 'credential-1', { ...config, enabledModules: ['billing'] }, browser(null))).toThrow(
      'Módulo Torge ainda não habilitável: billing',
    );
  });
});
