import { afterAll, describe, expect, it } from 'vitest';
import { createId } from '@tactia/shared';
import { prisma } from '../client';
import { BrowserExecutorInstanceRepository } from '../repositories/browser-executor-instance-repository';
import { BrowserWorkflowRepository } from '../repositories/browser-workflow-repository';
import { BrowserWorkflowBindingRepository } from '../repositories/browser-workflow-binding-repository';
import { CredentialRepository } from '../repositories/credential-repository';
import { DataSourceRepository } from '../repositories/data-source-repository';
import { SyncJobRepository } from '../repositories/sync-job-repository';
import { TenantRepository } from '../repositories/tenant-repository';

const tenants = new TenantRepository(prisma);
const credentials = new CredentialRepository(prisma);
const instances = new BrowserExecutorInstanceRepository(prisma);
const workflows = new BrowserWorkflowRepository(prisma);
const bindings = new BrowserWorkflowBindingRepository(prisma);
const sources = new DataSourceRepository(prisma);
const jobs = new SyncJobRepository(prisma);

const tenantIds: string[] = [];

afterAll(async () => {
  if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

async function newTenant() {
  const id = createId();
  const tenant = await tenants.create({ name: 'Browser Dyn Test', slug: `browser-dyn-${id}`, timezone: 'America/Sao_Paulo', currency: 'BRL' });
  tenantIds.push(tenant.id);
  return tenant;
}

describe('browser dynamic config persistence', () => {
  it('stores an executor instance referencing an api-key credential (no secret column)', async () => {
    const tenant = await newTenant();
    const cred = await credentials.create({ tenantId: tenant.id, provider: 'figranium:dedicated-1', encryptedData: 'ENC' });
    const instance = await instances.create({
      tenantId: tenant.id,
      provider: 'torge',
      engine: 'figranium',
      instanceKey: 'dedicated-1',
      baseUrl: 'https://figranium.internal/',
      dedicatedConnectionId: createId(),
      apiKeyCredentialId: cred.id,
      environment: 'test',
    });
    expect(instance.apiKeyCredentialId).toBe(cred.id);
    // The instance row exposes no apiKey/secret field.
    expect(Object.keys(instance)).not.toContain('apiKey');
    const found = await instances.findByKey({ tenantId: tenant.id, provider: 'torge', engine: 'figranium', instanceKey: 'dedicated-1', environment: 'test' });
    expect(found?.id).toBe(instance.id);
    // Tenant isolation.
    const other = await newTenant();
    expect(await instances.findById({ tenantId: other.id, id: instance.id })).toBeNull();
  });

  it('appends immutable revisions and repoints the active revision on import', async () => {
    const tenant = await newTenant();
    const identity = { tenantId: tenant.id, provider: 'torge', engine: 'figranium', workflowKey: 'torge.products', environment: 'test' };
    const first = await workflows.importRevision(identity, {
      workflowVersion: '1', definition: { schemaVersion: 1, workflowKey: 'torge.products', workflowVersion: '1', publishable: true, task: {} },
      definitionChecksum: 'c1', publishable: true, createdBy: 'op-1',
    });
    const second = await workflows.importRevision(identity, {
      workflowVersion: '2', definition: { schemaVersion: 1, workflowKey: 'torge.products', workflowVersion: '2', publishable: true, task: {} },
      definitionChecksum: 'c2', publishable: true, createdBy: 'op-1',
    });
    expect(first.revision.revision).toBe(1);
    expect(second.revision.revision).toBe(2);
    expect(second.workflow.activeRevisionId).toBe(second.revision.id);

    // Both revisions persist (append-only history); original is untouched.
    const list = await workflows.listRevisions({ tenantId: tenant.id, workflowId: second.workflow.id });
    expect(list.map((r) => r.revision)).toEqual([2, 1]);
    const original = await workflows.getRevision({ tenantId: tenant.id, id: first.revision.id });
    expect(original?.definitionChecksum).toBe('c1');

    // Reactivate the earlier revision without deleting the newer one.
    const reverted = await workflows.setActiveRevision({ tenantId: tenant.id, workflowId: second.workflow.id, revisionId: first.revision.id });
    expect(reverted?.activeRevisionId).toBe(first.revision.id);
    expect((await workflows.listRevisions({ tenantId: tenant.id, workflowId: second.workflow.id })).length).toBe(2);
  });

  it('tracks reconciliation marker + revision on the evolved binding and finds by marker', async () => {
    const tenant = await newTenant();
    const cred = await credentials.create({ tenantId: tenant.id, provider: 'figranium:dedicated-1', encryptedData: 'ENC' });
    const instance = await instances.create({
      tenantId: tenant.id, provider: 'torge', engine: 'figranium', instanceKey: 'dedicated-1',
      baseUrl: 'https://figranium.internal/', dedicatedConnectionId: createId(), apiKeyCredentialId: cred.id, environment: 'test',
    });
    const rev = await workflows.importRevision(
      { tenantId: tenant.id, provider: 'torge', engine: 'figranium', workflowKey: 'torge.products', environment: 'test' },
      { workflowVersion: '1', definition: { task: {} }, definitionChecksum: 'c1', publishable: true },
    );
    const marker = '[tactia:torge.products@1#1]';
    const binding = await bindings.upsert({
      provider: 'torge', engine: 'figranium', workflowKey: 'torge.products', workflowVersion: '1',
      environment: 'test', instanceKey: 'dedicated-1', externalTaskId: 'task-1', definitionChecksum: 'c1',
      tenantId: tenant.id, reconciliationMarker: marker, browserExecutorInstanceId: instance.id, workflowRevisionId: rev.revision.id,
    });
    expect(binding.reconciliationMarker).toBe(marker);
    expect(binding.workflowRevisionId).toBe(rev.revision.id);
    const byMarker = await bindings.findByMarker({ environment: 'test', instanceKey: 'dedicated-1', reconciliationMarker: marker });
    expect(byMarker?.id).toBe(binding.id);
    const tenantBindings = await bindings.listActiveForTenant({ tenantId: tenant.id, provider: 'torge', environment: 'test', instanceKey: 'dedicated-1' });
    expect(tenantBindings).toHaveLength(1);
  });

  it('persists the immutable config snapshot on the SyncJob at creation time', async () => {
    const tenant = await newTenant();
    const source = await sources.create({ tenantId: tenant.id, type: 'torge', name: 'Torge synthetic', status: 'active' });
    const snapshot = {
      engine: 'figranium', provider: 'torge', instanceKey: 'dedicated-1', environment: 'test',
      baseUrl: 'https://figranium.internal/', dedicatedConnectionId: source.id, apiKeyCredentialId: createId(),
      sourceCredentialId: createId(), source: 'database', workflows: [{ workflowKey: 'torge.products', workflowVersion: '1', taskId: 'task-1' }],
    };
    const job = await jobs.create({ tenantId: tenant.id, dataSourceId: source.id, configSnapshot: snapshot });
    const found = await jobs.findById({ tenantId: tenant.id, id: job.id });
    expect(found?.configSnapshot).toEqual(snapshot);
    // Snapshot carries only references (…CredentialId), never a decrypted key
    // value or a plaintext password field.
    const serialized = JSON.stringify(found?.configSnapshot);
    expect(serialized).not.toMatch(/"apiKey"\s*:/);
    expect(serialized).not.toMatch(/password|encryptedData/i);
  });
});
