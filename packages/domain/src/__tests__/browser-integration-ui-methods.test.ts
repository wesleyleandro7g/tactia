/**
 * Focused unit tests for the UI-supporting methods added to
 * BrowserIntegrationService: health probes (never returning the key),
 * immutable revision history, active-revision repoint (revert/reconcile) and
 * instance disable.
 *
 * ENCRYPTION_KEY is provided by vitest.config.ts so CredentialService can
 * encrypt the executor API key.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory repository fakes intentionally use `any` for brevity */
import { describe, expect, it, vi } from 'vitest';
import { createId, type RequestContext } from '@tactia/shared';
import type { VersionedWorkflow } from '@tactia/connectors';
import { BrowserIntegrationService } from '../services/browser-integration-service';

type CredentialRow = { id: string; tenantId: string; provider: string; encryptedData: string; createdAt: Date };

class FakeCredentialRepository {
  rows = new Map<string, CredentialRow>();
  async create(input: { tenantId: string; provider: string; encryptedData: string }) {
    const row: CredentialRow = { id: createId(), createdAt: new Date(), ...input };
    this.rows.set(row.id, row);
    return row;
  }
  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }
  async delete() {
    return null;
  }
}

class FakeInstanceRepository {
  rows = new Map<string, any>();
  async create(input: any) {
    const row = { id: createId(), createdAt: new Date(), active: input.active ?? true, allowInsecureHttp: input.allowInsecureHttp ?? false, dedicatedConnectionId: input.dedicatedConnectionId ?? null, ...input };
    this.rows.set(row.id, row);
    return row;
  }
  async findById({ tenantId, id }: any) {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }
  async findByKey() { return null; }
  async listActive(args: any) {
    return [...this.rows.values()].filter((r) => r.tenantId === args.tenantId && r.provider === args.provider && r.environment === args.environment && r.active);
  }
  async update({ tenantId, id, data }: any) {
    const row = await this.findById({ tenantId, id });
    if (!row) return null;
    Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
    return row;
  }
}

class FakeWorkflowRepository {
  workflows = new Map<string, any>();
  revisions = new Map<string, any>();
  async findByIdentity(identity: any) {
    return [...this.workflows.values()].find((w) => w.tenantId === identity.tenantId && w.workflowKey === identity.workflowKey && w.environment === identity.environment) ?? null;
  }
  async findById({ tenantId, id }: any) {
    const w = this.workflows.get(id);
    if (!w || w.tenantId !== tenantId) return null;
    return { ...w, activeRevision: w.activeRevisionId ? this.revisions.get(w.activeRevisionId) : null };
  }
  async listActive(args: any) {
    return [...this.workflows.values()].filter((w) => w.tenantId === args.tenantId && w.provider === args.provider && w.environment === args.environment && w.active).map((w) => ({ ...w, activeRevision: w.activeRevisionId ? this.revisions.get(w.activeRevisionId) : null }));
  }
  async getRevision({ tenantId, id }: any) {
    const r = this.revisions.get(id);
    return r && r.tenantId === tenantId ? r : null;
  }
  async listRevisions({ tenantId, workflowId }: any) {
    return [...this.revisions.values()].filter((r) => r.tenantId === tenantId && r.workflowId === workflowId).sort((a, b) => b.revision - a.revision);
  }
  async importRevision(identity: any, input: any) {
    let workflow = await this.findByIdentity(identity);
    if (!workflow) {
      workflow = { id: createId(), active: true, activeRevisionId: null, ...identity };
      this.workflows.set(workflow.id, workflow);
    }
    const existing = [...this.revisions.values()].filter((r) => r.workflowId === workflow.id);
    const nextRevision = existing.reduce((max, r) => Math.max(max, r.revision), 0) + 1;
    const revision = { id: createId(), workflowId: workflow.id, tenantId: identity.tenantId, revision: nextRevision, createdAt: new Date(), ...input };
    this.revisions.set(revision.id, revision);
    workflow.activeRevisionId = revision.id;
    workflow.active = true;
    return { workflow: { ...workflow, activeRevision: revision }, revision };
  }
  async setActiveRevision({ tenantId, workflowId, revisionId }: any) {
    const w = this.workflows.get(workflowId);
    const r = this.revisions.get(revisionId);
    if (!w || w.tenantId !== tenantId || !r || r.workflowId !== workflowId) return null;
    w.activeRevisionId = revisionId;
    return { ...w, activeRevision: r };
  }
}

class FakeBindingRepository {
  rows: any[] = [];
  async upsert(input: any) { const row = { id: createId(), active: true, ...input }; this.rows.push(row); return row; }
  async findByMarker() { return null; }
  async listActive() { return this.rows; }
  async listActiveForTenant() { return this.rows; }
}

const TENANT = createId();
function ctx(): RequestContext {
  return { requestId: createId(), tenantId: TENANT, userId: null, role: null, operatorId: createId() };
}
function versioned(version: string): VersionedWorkflow {
  return { schemaVersion: 1, workflowKey: 'torge.products', workflowVersion: version, publishable: true, task: { name: `p${version}`, description: 'x' } };
}

function build(healthProbe?: any) {
  const service = new BrowserIntegrationService({
    instances: new FakeInstanceRepository() as any,
    workflows: new FakeWorkflowRepository() as any,
    bindings: new FakeBindingRepository() as any,
    credentials: new FakeCredentialRepository() as any,
    env: { FIGRANIUM_INSTANCES_JSON: '{}', NODE_ENV: 'test' },
    healthProbe,
  });
  return service;
}

describe('BrowserIntegrationService — UI-supporting methods', () => {
  it('testHealth uses the probe and never returns the API key', async () => {
    const probe = vi.fn(async () => ({ healthy: true, safeMessage: 'ok' }));
    const service = build(probe);
    const result = await service.testHealth(ctx(), { baseUrl: 'https://x.internal/', apiKey: 'super-secret' });
    expect(result.healthy).toBe(true);
    expect(probe).toHaveBeenCalledWith({ baseUrl: 'https://x.internal/', apiKey: 'super-secret' });
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });

  it('testInstanceHealth re-reads the credential and probes without exposing the key', async () => {
    const probe = vi.fn(async (cfg: { apiKey: string }) => ({ healthy: cfg.apiKey === 'k', safeMessage: 'ok' }));
    const service = build(probe);
    const inst = await service.createInstance(ctx(), {
      provider: 'torge', engine: 'figranium', instanceKey: 'i1', baseUrl: 'https://x.internal/', dedicatedConnectionId: createId(), environment: 'test', apiKey: 'k',
    });
    const result = await service.testInstanceHealth(ctx(), inst.id);
    expect(result.healthy).toBe(true);
    expect(probe).toHaveBeenCalledWith({ baseUrl: 'https://x.internal/', apiKey: 'k' });
  });

  it('lists immutable revisions and reverts the active one without deleting history', async () => {
    const service = build();
    const c = ctx();
    const r1 = await service.importWorkflow(c, { provider: 'torge', environment: 'test', workflow: versioned('1') });
    await service.importWorkflow(c, { provider: 'torge', environment: 'test', workflow: versioned('2') });
    const revisions = await service.listRevisions(c, r1.workflowId);
    expect(revisions).toHaveLength(2);
    expect(revisions[0]!.isActive).toBe(true); // newest active
    expect(revisions[0]!.revision).toBe(2);

    const older = revisions.find((r) => r.revision === 1)!;
    const reverted = await service.setActiveRevision(c, { workflowId: r1.workflowId, revisionId: older.id });
    expect(reverted.activeRevision.revision).toBe(1);
    // History intact.
    const after = await service.listRevisions(c, r1.workflowId);
    expect(after).toHaveLength(2);
    expect(after.find((r) => r.revision === 1)!.isActive).toBe(true);
  });

  it('disables an instance (soft) and it drops from listActive', async () => {
    const service = build();
    const c = ctx();
    const inst = await service.createInstance(c, {
      provider: 'torge', engine: 'figranium', instanceKey: 'i1', baseUrl: 'https://x.internal/', dedicatedConnectionId: createId(), environment: 'test', apiKey: 'k',
    });
    const disabled = await service.disableInstance(c, inst.id);
    expect(disabled.active).toBe(false);
    const active = await service.listInstances(c, 'torge', 'test');
    expect(active.find((i) => i.id === inst.id)).toBeUndefined();
  });
});
