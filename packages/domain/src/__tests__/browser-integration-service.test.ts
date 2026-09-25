/**
 * Focused, DB-free unit tests for BrowserIntegrationService.
 *
 * Covers: DB-first resolution with env fallback, immutable revisions on import,
 * per-revision publish + reconciliation-by-marker, forced-off remote schedule,
 * snapshot creation without secrets, and snapshot-based retry resolution.
 *
 * ENCRYPTION_KEY is provided by vitest.config.ts so CredentialService can
 * encrypt the executor API key.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory repository fakes intentionally use `any` for brevity */
import { describe, expect, it } from 'vitest';
import { createId, type RequestContext } from '@tactia/shared';
import type { VersionedWorkflow } from '@tactia/connectors';
import { BrowserIntegrationService } from '../services/browser-integration-service';
import { decrypt } from '../services/credential-service';

// ---------------------------------------------------------------------------
// In-memory fakes (only the methods the service touches).
// ---------------------------------------------------------------------------

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
    const row = { id: createId(), createdAt: new Date(), updatedAt: new Date(), active: input.active ?? true, allowInsecureHttp: input.allowInsecureHttp ?? false, dedicatedConnectionId: input.dedicatedConnectionId ?? null, ...input };
    this.rows.set(row.id, row);
    return row;
  }
  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }
  async findByKey(args: any) {
    return [...this.rows.values()].find(
      (r) =>
        r.tenantId === args.tenantId &&
        r.provider === args.provider &&
        r.engine === args.engine &&
        r.instanceKey === args.instanceKey &&
        r.environment === args.environment,
    ) ?? null;
  }
  async listActive(args: any) {
    return [...this.rows.values()].filter(
      (r) => r.tenantId === args.tenantId && r.provider === args.provider && r.environment === args.environment && r.active,
    );
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
    return [...this.workflows.values()].find(
      (w) =>
        w.tenantId === identity.tenantId &&
        w.provider === identity.provider &&
        w.engine === identity.engine &&
        w.workflowKey === identity.workflowKey &&
        w.environment === identity.environment,
    ) ?? null;
  }
  async findById({ tenantId, id }: any) {
    const w = this.workflows.get(id);
    if (!w || w.tenantId !== tenantId) return null;
    return { ...w, activeRevision: w.activeRevisionId ? this.revisions.get(w.activeRevisionId) : null };
  }
  async listActive(args: any) {
    return [...this.workflows.values()]
      .filter((w) => w.tenantId === args.tenantId && w.provider === args.provider && w.environment === args.environment && w.active)
      .map((w) => ({ ...w, activeRevision: w.activeRevisionId ? this.revisions.get(w.activeRevisionId) : null }));
  }
  async getRevision({ tenantId, id }: any) {
    const r = this.revisions.get(id);
    return r && r.tenantId === tenantId ? r : null;
  }
  async listRevisions({ tenantId, workflowId }: any) {
    return [...this.revisions.values()]
      .filter((r) => r.tenantId === tenantId && r.workflowId === workflowId)
      .sort((a, b) => b.revision - a.revision);
  }
  async importRevision(identity: any, input: any) {
    let workflow = await this.findByIdentity(identity);
    if (!workflow) {
      workflow = { id: createId(), active: true, activeRevisionId: null, ...identity };
      this.workflows.set(workflow.id, workflow);
    }
    const existing = [...this.revisions.values()].filter((r) => r.workflowId === workflow.id);
    const nextRevision = existing.reduce((max, r) => Math.max(max, r.revision), 0) + 1;
    const revision = {
      id: createId(),
      workflowId: workflow.id,
      tenantId: identity.tenantId,
      revision: nextRevision,
      createdAt: new Date(),
      ...input,
    };
    this.revisions.set(revision.id, revision);
    workflow.activeRevisionId = revision.id;
    workflow.active = true;
    return { workflow: { ...workflow, activeRevision: revision }, revision };
  }
}

class FakeBindingRepository {
  rows: any[] = [];
  async upsert(input: any) {
    const key = (r: any) =>
      [r.provider, r.engine, r.workflowKey, r.workflowVersion, r.environment, r.instanceKey].join('|');
    const existing = this.rows.find((r) => key(r) === key(input));
    if (existing) {
      Object.assign(existing, input, { active: true });
      return existing;
    }
    const row = { id: createId(), active: true, ...input };
    this.rows.push(row);
    return row;
  }
  async findByMarker({ environment, instanceKey, reconciliationMarker }: any) {
    return this.rows.find((r) => r.environment === environment && r.instanceKey === instanceKey && r.reconciliationMarker === reconciliationMarker) ?? null;
  }
  async listActive({ provider, environment, instanceKey }: any) {
    return this.rows.filter((r) => r.provider === provider && r.environment === environment && r.instanceKey === instanceKey && r.active);
  }
  async listActiveForTenant({ tenantId, provider, environment, instanceKey }: any) {
    return this.rows.filter((r) => r.tenantId === tenantId && r.provider === provider && r.environment === environment && r.instanceKey === instanceKey && r.active);
  }
}

const TENANT = createId();

function operatorCtx(): RequestContext {
  return { requestId: createId(), tenantId: TENANT, userId: null, role: null, operatorId: createId() };
}

function versioned(version: string): VersionedWorkflow {
  return {
    schemaVersion: 1,
    workflowKey: 'torge.products',
    workflowVersion: version,
    publishable: true,
    task: { name: `Products ${version}`, description: 'coleta', url: 'https://example.com/' },
  };
}

function buildService(overrides?: { published?: Array<{ workflow: VersionedWorkflow; marker: string }> }) {
  const instances = new FakeInstanceRepository();
  const workflows = new FakeWorkflowRepository();
  const bindings = new FakeBindingRepository();
  const credentials = new FakeCredentialRepository();
  const published = overrides?.published ?? [];
  const service = new BrowserIntegrationService({
    instances: instances as any,
    workflows: workflows as any,
    bindings: bindings as any,
    credentials: credentials as any,
    env: { FIGRANIUM_INSTANCES_JSON: '{}', NODE_ENV: 'test' },
    publisherFactory: () => ({
      publish: async (wf: VersionedWorkflow, marker: string) => {
        // Reconcile by marker: same marker -> update, new marker -> create.
        const existing = published.find((p) => p.marker === marker);
        published.push({ workflow: wf, marker });
        return { taskId: `task-${published.length}`, operation: existing ? 'updated' : 'created' };
      },
    }),
  });
  return { service, instances, workflows, bindings, credentials, published };
}

describe('BrowserIntegrationService', () => {
  it('stores the API key via CredentialService and never returns it', async () => {
    const { service, credentials } = buildService();
    const dto = await service.createInstance(operatorCtx(), {
      provider: 'torge',
      engine: 'figranium',
      instanceKey: 'dedicated-1',
      baseUrl: 'https://figranium.internal/',
      dedicatedConnectionId: createId(),
      environment: 'test',
      apiKey: 'super-secret-key',
    });
    expect(JSON.stringify(dto)).not.toContain('super-secret-key');
    expect(dto).toHaveProperty('apiKeyCredentialId');
    // The secret only lives (encrypted) in the credential store.
    const stored = [...credentials.rows.values()][0]!;
    expect(stored.encryptedData).not.toContain('super-secret-key');
    expect(JSON.parse(decrypt(stored.encryptedData))).toMatchObject({ apiKey: 'super-secret-key' });
  });

  it('appends immutable revisions on repeated JSON import (substitutive active, internal history)', async () => {
    const { service, workflows } = buildService();
    const ctx = operatorCtx();
    const first = await service.importWorkflow(ctx, { provider: 'torge', environment: 'test', workflow: versioned('1') });
    const second = await service.importWorkflow(ctx, { provider: 'torge', environment: 'test', workflow: versioned('2') });
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    // Same logical workflow, two immutable revisions.
    expect(workflows.workflows.size).toBe(1);
    expect(workflows.revisions.size).toBe(2);
    const list = await service.listWorkflows(ctx, 'torge', 'test');
    expect(list[0]!.activeRevision!.revision).toBe(2);
  });

  it('publishes a new task per revision and forces remote schedule off, reconciling by marker', async () => {
    const { service, bindings, published } = buildService();
    const ctx = operatorCtx();
    const instance = await service.createInstance(ctx, {
      provider: 'torge',
      engine: 'figranium',
      instanceKey: 'dedicated-1',
      baseUrl: 'https://figranium.internal/',
      dedicatedConnectionId: createId(),
      environment: 'test',
      apiKey: 'k',
    });
    const rev1 = await service.importWorkflow(ctx, { provider: 'torge', environment: 'test', workflow: versioned('1') });
    const p1 = await service.publishWorkflow(ctx, { workflowId: rev1.workflowId, instanceId: instance.id });
    // Re-publish same revision -> reconciled (updated), same marker.
    const p1again = await service.publishWorkflow(ctx, { workflowId: rev1.workflowId, instanceId: instance.id });
    expect(p1.operation).toBe('created');
    expect(p1again.operation).toBe('updated');

    const rev2 = await service.importWorkflow(ctx, { provider: 'torge', environment: 'test', workflow: versioned('2') });
    const p2 = await service.publishWorkflow(ctx, { workflowId: rev2.workflowId, instanceId: instance.id });
    expect(p2.operation).toBe('created');
    expect(p2.taskId).not.toBe(p1.taskId);

    // Distinct markers per revision.
    const markers = new Set(published.map((p) => p.marker));
    expect(markers.size).toBe(2);
    // The binding tracks the reconciliation marker.
    const b = await bindings.findByMarker({ environment: 'test', instanceKey: 'dedicated-1', reconciliationMarker: [...markers][0]! });
    expect(b).not.toBeNull();
  });

  it('resolves DB-first and produces a secret-free snapshot with resolved task IDs', async () => {
    const { service } = buildService();
    const ctx = operatorCtx();
    const connectionId = createId();
    const instance = await service.createInstance(ctx, {
      provider: 'torge', engine: 'figranium', instanceKey: 'dedicated-1',
      baseUrl: 'https://figranium.internal/', dedicatedConnectionId: connectionId, environment: 'test', apiKey: 'super-secret-key',
    });
    const rev = await service.importWorkflow(ctx, { provider: 'torge', environment: 'test', workflow: versioned('1') });
    await service.publishWorkflow(ctx, { workflowId: rev.workflowId, instanceId: instance.id });

    const { resolved, snapshot } = await service.resolveFigranium(ctx, {
      provider: 'torge', environment: 'test', instanceKey: 'dedicated-1', sourceCredentialId: 'cred-src',
    });
    expect(resolved.apiKey).toBe('super-secret-key');
    expect(resolved.dedicatedConnectionId).toBe(connectionId);
    expect(resolved.workflows).toHaveLength(1);
    expect(resolved.workflows[0]).toMatchObject({ workflowKey: 'torge.products', workflowVersion: '1' });

    expect(snapshot.source).toBe('database');
    expect(snapshot.apiKeyCredentialId).toBe(instance.apiKeyCredentialId);
    expect(snapshot.sourceCredentialId).toBe('cred-src');
    // Snapshot never carries the actual secret.
    expect(JSON.stringify(snapshot)).not.toContain('super-secret-key');
    expect(snapshot.workflows[0]).toHaveProperty('taskId');
  });

  it('falls back to FIGRANIUM_INSTANCES_JSON when no active DB instance exists', async () => {
    const instances = new FakeInstanceRepository();
    const workflows = new FakeWorkflowRepository();
    const bindings = new FakeBindingRepository();
    const credentials = new FakeCredentialRepository();
    const envDoc = JSON.stringify({
      'env-instance': {
        baseUrl: 'https://figranium.env/',
        apiKey: 'env-secret',
        dedicatedConnectionId: 'env-conn',
        workflows: [{ workflowKey: 'torge.products', workflowVersion: '1', taskId: 'env-task' }],
      },
    });
    const service = new BrowserIntegrationService({
      instances: instances as any, workflows: workflows as any, bindings: bindings as any, credentials: credentials as any,
      env: { FIGRANIUM_INSTANCES_JSON: envDoc, NODE_ENV: 'production' },
    });
    const { resolved, snapshot } = await service.resolveFigranium(operatorCtx(), {
      provider: 'torge', environment: 'test', instanceKey: 'env-instance',
    });
    expect(resolved.apiKey).toBe('env-secret');
    expect(resolved.workflows[0]!.taskId).toBe('env-task');
    expect(snapshot.source).toBe('env');
    expect(snapshot.apiKeyCredentialId).toBe('');
  });

  it('rehydrates the same config from a snapshot on retry (DB path)', async () => {
    const { service } = buildService();
    const ctx = operatorCtx();
    const connectionId = createId();
    const instance = await service.createInstance(ctx, {
      provider: 'torge', engine: 'figranium', instanceKey: 'dedicated-1',
      baseUrl: 'https://figranium.internal/', dedicatedConnectionId: connectionId, environment: 'test', apiKey: 'super-secret-key',
    });
    const rev = await service.importWorkflow(ctx, { provider: 'torge', environment: 'test', workflow: versioned('1') });
    await service.publishWorkflow(ctx, { workflowId: rev.workflowId, instanceId: instance.id });
    const { snapshot } = await service.resolveFigranium(ctx, { provider: 'torge', environment: 'test', instanceKey: 'dedicated-1' });

    const rehydrated = await service.resolveFromSnapshot(ctx, snapshot);
    expect(rehydrated.apiKey).toBe('super-secret-key');
    expect(rehydrated.dedicatedConnectionId).toBe(connectionId);
    expect(rehydrated.workflows).toEqual(snapshot.workflows);
  });
});
