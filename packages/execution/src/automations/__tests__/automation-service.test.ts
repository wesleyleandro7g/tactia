import { describe, expect, it } from 'vitest';
import {
  decideEmailEffect,
  notifyEmailVersionBody,
  renderReportCsv,
  reportsPortalVersionBody,
  signWebhook,
  syncCompletedEvent,
  validateReportBundle,
} from '@tactia/domain';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { EmailDeliveryUncertainError } from '../email-uncertainty';
import { createReportsPortalBrowser } from '../reports-browser';
import { MemoryAutomationStore } from '../memory-store';
import { effectProposalFromAction, type AutomationBrowserPort, type AutomationEffectPort, type EffectProposal } from '../ports';
import { AutomationService } from '../service';

const TENANT = 'tenant-demo';

function ctx(partial: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req-1',
    tenantId: TENANT,
    userId: 'user-1',
    role: 'admin',
    operatorId: 'operator-1',
    ip: null,
    ...partial,
  };
}

function memberCtx(): RequestContext {
  return ctx({ role: 'member', operatorId: null, userId: 'member-1' });
}

function params(recipient = 'ops@demo.tactia') {
  return {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    reports: ['sales', 'inventory', 'financial'],
    recipient,
  };
}

function csvFile(kind: 'sales' | 'inventory' | 'financial') {
  return {
    name: `${kind}.csv`,
    mime: 'text/csv',
    body: Buffer.from(renderReportCsv(kind, '2026-09-01', '2026-09-30')),
  };
}

describe('automation policy and reports', () => {
  it('does not let effectMode expand the published recipient list', () => {
    const policy = {
      connections: ['c1'],
      effects: {
        send_email: {
          preauthorizedRecipients: ['ops@demo.tactia'],
          approvalRecipients: ['cfo@demo.tactia'],
        },
      },
    };
    expect(decideEmailEffect(policy, 'ops@demo.tactia', false)).toBe('allow');
    expect(decideEmailEffect(policy, 'ops@demo.tactia', true)).toBe('approve');
    expect(decideEmailEffect(policy, 'cfo@demo.tactia', false)).toBe('approve');
    expect(decideEmailEffect(policy, 'stranger@example.com', true)).toBe('reject');
  });

  it('records a sync event only for full success', () => {
    expect(syncCompletedEvent({ status: 'partial', tenantId: 't', dataSourceId: 'c', syncJobId: 'j' })).toBeNull();
    expect(syncCompletedEvent({ status: 'failed', tenantId: 't', dataSourceId: 'c', syncJobId: 'j' })).toBeNull();
    expect(syncCompletedEvent({ status: 'completed', tenantId: 't', dataSourceId: 'c', syncJobId: 'j' })?.type).toBe(
      'sync.completed',
    );
  });

  it('rejects a bundle that misses a requested report or the period', () => {
    const partial = validateReportBundle([csvFile('sales')], {
      reports: ['sales', 'inventory'],
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(partial.ok).toBe(false);
    const wrongPeriod = validateReportBundle(
      [{ name: 'sales.csv', mime: 'text/csv', body: renderReportCsv('sales', '2026-08-01', '2026-08-31') }],
      { reports: ['sales'], periodStart: '2026-09-01', periodEnd: '2026-09-30' },
    );
    expect(wrongPeriod.ok).toBe(false);
  });
});

describe('AutomationService', () => {
  function setup(options?: {
    browser?: AutomationBrowserPort['execute'];
    effect?: Partial<AutomationEffectPort>;
    leaseMs?: number;
  }) {
    const store = new MemoryAutomationStore([TENANT]);
    const objects = new Map<string, Buffer>();
    const calls = { browser: 0, send: 0, revisions: [] as string[], schedules: [] as string[] };
    let browserImpl: AutomationBrowserPort['execute'] = async (input) => {
      calls.browser += 1;
      calls.revisions.push(input.revisionId);
      return {
        status: 'succeeded',
        retryable: false,
        files: [csvFile('sales'), csvFile('inventory'), csvFile('financial')],
      };
    };
    const effects: EffectProposal[] = [];
    const effect: AutomationEffectPort = {
      async propose(input) {
        calls.send += 1;
        effects.push({
          status: 'completed',
          actionExecutionId: `exec-${calls.send}`,
          approvalId: null,
          output: { messageId: '<smtp-1>' },
        });
        return effects.at(-1)!;
      },
      async lookup() {
        return null;
      },
      ...options?.effect,
    };
    if (options?.browser) browserImpl = options.browser as AutomationBrowserPort['execute'];
    const service = new AutomationService({
      store,
      browser: { execute: (input) => browserImpl(input) },
      effects: effect,
      storage: {
        async put({ id, body }) {
          const key = `mem/${id}.csv`;
          objects.set(key, body);
          return { key };
        },
        async get(key) {
          const body = objects.get(key);
          if (!body) throw new Error('missing');
          return { body, contentType: 'text/csv' };
        },
      },
      revisions: { async pin() { return 'rev-published'; } },
      ...(options?.leaseMs ? { leaseMs: options.leaseMs } : {}),
      schedules: {
        async onRunSettled(input) {
          calls.schedules.push(input.status);
        },
      },
      publish: async () => undefined,
    });
    return { service, store, calls, effects, objects };
  }

  async function publishPilot(
    service: AutomationService,
    recipients?: { preauthorizedRecipients?: string[]; approvalRecipients?: string[] },
  ) {
    const draft = await service.createDraft(ctx(), 'reports.portal');
    const updated = await service.updateDraft(
      ctx(),
      draft.id,
      reportsPortalVersionBody({
        connectionId: 'demo-reports-portal',
        preauthorizedRecipients: recipients?.preauthorizedRecipients ?? ['ops@demo.tactia'],
        approvalRecipients: recipients?.approvalRecipients ?? ['cfo@demo.tactia'],
        revisionId: 'rev-1',
      }),
    );
    await service.publish(ctx(), draft.id, updated.versionId);
    return draft.id;
  }

  it('runs the pilot once and returns a tracking link without waiting inside start', async () => {
    const { service, calls } = setup();
    const id = await publishPilot(service);
    const queued = await service.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'page:1',
    });
    expect(queued.status).toBe('queued');
    expect(queued.url).toBe(`/automations/${id}/runs/${queued.id}`);
    expect(calls.browser).toBe(0);
    const outcome = await service.execute(TENANT, queued.id);
    expect(outcome).toBe('done');
    const done = await service.getRun(memberCtx(), id, queued.id);
    expect(done.status).toBe('completed');
    expect(done.artifacts).toHaveLength(3);
    expect(calls.browser).toBe(1);
    expect(calls.send).toBe(1);
    expect(calls.revisions).toEqual(['rev-1']);
  });

  it('returns the same run for a repeated trigger and conflicts when the content changes', async () => {
    const { service } = setup();
    const id = await publishPilot(service);
    const first = await service.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'agent',
      idempotencyKey: 'agent:1',
    });
    const second = await service.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'agent',
      idempotencyKey: 'agent:1',
    });
    expect(second.id).toBe(first.id);
    await expect(
      service.start(memberCtx(), {
        automationId: id,
        params: params('cfo@demo.tactia'),
        origin: 'agent',
        idempotencyKey: 'agent:1',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('keeps an in-flight run on the version it started with', async () => {
    const { service, store, calls } = setup();
    const id = await publishPilot(service);
    const queued = await service.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'pin',
    });
    const current = await store.findVersion(TENANT, queued.versionId);
    await store.insertVersion({
      ...current!,
      id: 'version-2',
      version: 99,
      steps: [
        {
          key: 'export',
          kind: 'browser_workflow',
          retryable: true,
          workflowKey: 'other',
          workflowVersion: '9',
          revisionId: 'rev-new',
          connectionId: 'demo-reports-portal',
        },
      ],
      publishedAt: new Date(),
      createdAt: new Date(),
    });
    await store.updateAutomation(TENANT, id, { publishedVersionId: 'version-2' });
    await service.execute(TENANT, queued.id);
    expect(calls.revisions).toEqual(['rev-1']);
  });

  it('blocks send when the export is partial and keeps the files', async () => {
    const { service, calls } = setup({
      browser: async () => ({
        status: 'partial',
        retryable: false,
        message: 'Exportação incompleta.',
        files: [csvFile('sales')],
      }),
    });
    const id = await publishPilot(service);
    const queued = await service.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'partial',
    });
    await service.execute(TENANT, queued.id);
    const run = await service.getRun(memberCtx(), id, queued.id);
    expect(run.status).toBe('failed');
    expect(run.artifacts).toHaveLength(1);
    expect(calls.send).toBe(0);
  });

  it('resumes a failed send without exporting again', async () => {
    let sends = 0;
    const { service, calls } = setup({
      effect: {
        async propose() {
          sends += 1;
          if (sends === 1) {
            return { status: 'failed', actionExecutionId: 'e1', approvalId: null, error: 'SMTP indisponível' };
          }
          return { status: 'completed', actionExecutionId: 'e2', approvalId: null, output: { messageId: '<ok>' } };
        },
        async lookup() {
          return null;
        },
      },
    });
    const id = await publishPilot(service);
    const queued = await service.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'smtp',
    });
    await service.execute(TENANT, queued.id);
    expect((await service.getRun(memberCtx(), id, queued.id)).status).toBe('failed');
    await service.resume(memberCtx(), id, queued.id);
    await service.execute(TENANT, queued.id);
    const done = await service.getRun(memberCtx(), id, queued.id);
    expect(done.status).toBe('completed');
    expect(calls.browser).toBe(1);
    expect(sends).toBe(2);
  });

  it('parks an uncertain send until reconciliation', async () => {
    let sends = 0;
    const { service } = setup({
      effect: {
        async propose() {
          sends += 1;
          if (sends === 1) throw new EmailDeliveryUncertainError();
          return { status: 'completed', actionExecutionId: 'e2', approvalId: null, output: { messageId: '<ok>' } };
        },
        async lookup() {
          return null;
        },
      },
    });
    const id = await publishPilot(service);
    const queued = await service.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'uncertain',
    });
    await service.execute(TENANT, queued.id);
    expect((await service.getRun(ctx(), id, queued.id)).status).toBe('needs_attention');
    expect(await service.execute(TENANT, queued.id)).toBe('busy');
    expect(sends).toBe(1);
    await service.reconcile(ctx(), id, queued.id, 'not_sent');
    await service.execute(TENANT, queued.id);
    expect((await service.getRun(ctx(), id, queued.id)).status).toBe('completed');
    expect(sends).toBe(2);
  });

  it('waits for approval and does not count that wait as schedule success', async () => {
    const proposals = new Map<string, EffectProposal>();
    const { service, calls } = setup({
      effect: {
        async propose() {
          const proposal: EffectProposal = {
            status: 'awaiting_approval',
            actionExecutionId: 'approval-exec',
            approvalId: 'approval-1',
            output: null,
          };
          proposals.set(proposal.actionExecutionId, proposal);
          return proposal;
        },
        async lookup(_tenantId, actionExecutionId) {
          return proposals.get(actionExecutionId) ?? null;
        },
      },
    });
    const id = await publishPilot(service);
    const queued = await service.start(ctx({ role: 'owner' }), {
      automationId: id,
      params: params(),
      origin: 'schedule',
      idempotencyKey: 'schedule:occ-1',
      scheduleOccurrenceId: 'occ-1',
      forceApproval: true,
    });
    await service.execute(TENANT, queued.id);
    expect(calls.schedules).toEqual(['awaiting_approval']);
    expect((await service.getRun(ctx(), id, queued.id)).status).toBe('awaiting_approval');
    proposals.set('approval-exec', {
      status: 'completed',
      actionExecutionId: 'approval-exec',
      approvalId: 'approval-1',
      output: { messageId: '<smtp>' },
    });
    await service.onExecutionSettled(TENANT, 'approval-exec');
    await service.execute(TENANT, queued.id);
    expect((await service.getRun(ctx(), id, queued.id)).status).toBe('completed');
    expect(calls.schedules).toContain('completed');
  });

  it('rejects a recipient outside the published policy', async () => {
    const { service, calls } = setup();
    const id = await publishPilot(service);
    const queued = await service.start(memberCtx(), {
      automationId: id,
      params: params('stranger@example.com'),
      origin: 'webhook',
      idempotencyKey: 'deny',
    });
    await service.execute(TENANT, queued.id);
    expect((await service.getRun(memberCtx(), id, queued.id)).status).toBe('failed');
    expect(calls.send).toBe(0);
  });

  it('does not run two workers on the same execution', async () => {
    let release: () => void = () => undefined;
    const entered = deferred<void>();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, calls } = setup({
      browser: async () => {
        calls.browser += 1;
        entered.resolve();
        await gate;
        return { status: 'succeeded', retryable: false, files: [csvFile('sales'), csvFile('inventory'), csvFile('financial')] };
      },
    });
    const id = await publishPilot(service);
    const queued = await service.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'race',
    });
    const first = service.execute(TENANT, queued.id);
    await entered.promise;
    expect(await service.execute(TENANT, queued.id)).toBe('busy');
    release();
    expect(await first).toBe('done');
    expect(calls.browser).toBe(1);
  });

  it('recovers a run whose dispatch never reached the queue', async () => {
    const objects = new Map<string, Buffer>();
    const published: string[] = [];
    let down = true;
    const { service, store } = setup();
    const recovering = new AutomationService({
      store,
      browser: {
        async execute() {
          return { status: 'succeeded', retryable: false, files: [csvFile('sales'), csvFile('inventory'), csvFile('financial')] };
        },
      },
      effects: {
        async propose() {
          return { status: 'completed', actionExecutionId: 'e', approvalId: null, output: { messageId: 'm' } };
        },
        async lookup() {
          return null;
        },
      },
      storage: {
        async put({ id, body }) {
          const key = `mem/${id}.csv`;
          objects.set(key, body);
          return { key };
        },
        async get(key) {
          const body = objects.get(key);
          if (!body) throw new Error('missing');
          return { body, contentType: 'text/csv' };
        },
      },
      revisions: { async pin() { return 'rev-1'; } },
      publish: async (job) => {
        if (down) throw new Error('queue down');
        published.push(job.runId);
      },
    });
    const id = await publishPilot(recovering);
    const queued = await recovering.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'recover',
    });
    expect(published).toHaveLength(0);
    down = false;
    await recovering.recoverAndDispatch();
    expect(published).toContain(queued.id);
    await recovering.execute(TENANT, queued.id);
    expect((await recovering.getRun(memberCtx(), id, queued.id)).status).toBe('completed');
  });

  it('isolates runs by tenant and pauses new triggers', async () => {
    const { service, store } = setup();
    const id = await publishPilot(service);
    await store.setEnabled('other', true);
    await expect(service.get(ctx({ tenantId: 'other', userId: 'u2' }), id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await service.pause(ctx(), id);
    await expect(
      service.start(memberCtx(), { automationId: id, params: params(), origin: 'page', idempotencyKey: 'paused' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('replays a webhook and conflicts when the body changes', async () => {
    const { service } = setup();
    const id = await publishPilot(service);
    const created = await service.createTrigger(ctx(), id, { kind: 'webhook' });
    const body = JSON.stringify(params());
    const timestamp = String(Date.now());
    const signature = signWebhook(created.secret!, timestamp, body);
    const headers = { timestamp, signature, eventId: 'evt-1' };
    const first = await service.acceptWebhook(created.id, headers, body);
    const replay = await service.acceptWebhook(created.id, headers, body);
    expect(replay.id).toBe(first.id);
    const other = JSON.stringify(params('cfo@demo.tactia'));
    await expect(
      service.acceptWebhook(created.id, { ...headers, signature: signWebhook(created.secret!, timestamp, other) }, other),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('does not start an automation from a partial sync event', async () => {
    const { service, store } = setup();
    const id = await publishPilot(service);
    await store.updateAutomation(TENANT, id, { parameterDefaults: params() });
    await service.createTrigger(ctx(), id, {
      kind: 'internal_event',
      eventType: 'sync.completed',
      connectionId: 'source-1',
    });
    await service.recordSyncCompleted({ tenantId: TENANT, dataSourceId: 'source-1', syncJobId: 'job-partial', status: 'partial' });
    expect((await service.dispatchDomainEvents()).started).toBe(0);
    await service.recordSyncCompleted({ tenantId: TENANT, dataSourceId: 'source-1', syncJobId: 'job-ok', status: 'completed' });
    expect((await service.dispatchDomainEvents()).started).toBe(1);
  });

  it('keeps sync.completed pending when a trigger fails and retries without duplicating the run', async () => {
    const { service, store } = setup();
    const id = await publishPilot(service);
    await store.updateAutomation(TENANT, id, { parameterDefaults: params() });
    await service.createTrigger(ctx(), id, {
      kind: 'internal_event',
      eventType: 'sync.completed',
      connectionId: 'source-1',
    });
    await service.pause(ctx(), id);
    await service.recordSyncCompleted({
      tenantId: TENANT,
      dataSourceId: 'source-1',
      syncJobId: 'job-retry',
      status: 'completed',
    });
    const failed = await service.dispatchDomainEvents();
    expect(failed).toMatchObject({ started: 0, pending: 1 });
    await service.resumePublication(ctx(), id);
    const retried = await service.dispatchDomainEvents();
    expect(retried).toMatchObject({ started: 1, pending: 0 });
    expect(await service.dispatchDomainEvents()).toMatchObject({ started: 0, pending: 0 });
    expect(await store.listRuns(TENANT, id, 10)).toHaveLength(1);
  });

  it('keeps an in-flight email running until the action result is confirmed', async () => {
    let phase: EffectProposal['status'] = 'in_progress';
    let sends = 0;
    const { service } = setup({
      effect: {
        async propose() {
          sends += 1;
          return { status: phase, actionExecutionId: 'mail-1', approvalId: null };
        },
        async lookup() {
          return { status: phase, actionExecutionId: 'mail-1', approvalId: null, output: phase === 'completed' ? { messageId: '<ok>' } : null };
        },
      },
    });
    const id = await publishPilot(service);
    const queued = await service.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'async-mail',
    });
    expect(await service.execute(TENANT, queued.id)).toBe('parked');
    expect((await service.getRun(memberCtx(), id, queued.id)).status).toBe('running');
    phase = 'completed';
    await service.onExecutionSettled(TENANT, 'mail-1');
    expect(await service.execute(TENANT, queued.id)).toBe('done');
    expect((await service.getRun(memberCtx(), id, queued.id)).status).toBe('completed');
    expect(sends).toBe(1);
  });

  it('does not fail when approval is followed by an asynchronous send', async () => {
    let phase = 'awaiting_approval';
    const { service, calls } = setup({
      effect: {
        async propose() {
          return { status: 'awaiting_approval', actionExecutionId: 'approval-async', approvalId: 'approval-9' };
        },
        async lookup() {
          return {
            status: phase as EffectProposal['status'],
            actionExecutionId: 'approval-async',
            approvalId: 'approval-9',
            output: phase === 'completed' ? { messageId: '<ok>' } : null,
          };
        },
      },
    });
    const id = await publishPilot(service);
    const queued = await service.start(ctx({ role: 'owner' }), {
      automationId: id,
      params: params(),
      origin: 'schedule',
      idempotencyKey: 'approval-async',
      scheduleOccurrenceId: 'occ-async',
      forceApproval: true,
    });
    await service.execute(TENANT, queued.id);
    expect((await service.getRun(ctx(), id, queued.id)).status).toBe('awaiting_approval');
    phase = 'approved';
    await service.onExecutionSettled(TENANT, 'approval-async');
    expect((await service.getRun(ctx(), id, queued.id)).status).toBe('running');
    expect(calls.schedules).not.toContain('failed');
    phase = 'completed';
    await service.onExecutionSettled(TENANT, 'approval-async');
    await service.execute(TENANT, queued.id);
    expect((await service.getRun(ctx(), id, queued.id)).status).toBe('completed');
  });

  it('drops writes after lease loss and lets a later worker finish', async () => {
    let lost = false;
    const { service, store, calls, objects } = setup({
      browser: async (input) => {
        calls.browser += 1;
        if (!lost) {
          lost = true;
          store.expireLease(input.runId);
        }
        return {
          status: 'succeeded',
          retryable: false,
          files: [csvFile('sales'), csvFile('inventory'), csvFile('financial')],
        };
      },
    });
    const id = await publishPilot(service);
    const queued = await service.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'lease-loss',
    });
    expect(await service.execute(TENANT, queued.id)).toBe('deferred');
    expect(objects.size).toBe(0);
    expect(calls.send).toBe(0);
    expect(await service.execute(TENANT, queued.id)).toBe('done');
    expect(calls.browser).toBe(2);
    expect(objects.size).toBe(3);
    expect((await service.getRun(memberCtx(), id, queued.id)).status).toBe('completed');
  });

  it('renews the lease during a long export', async () => {
    const { service, store } = setup({
      leaseMs: 80,
      browser: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 180));
        const run = await store.findRun(TENANT, input.runId);
        expect(run?.leaseUntil && run.leaseUntil.getTime()).toBeGreaterThan(Date.now());
        return {
          status: 'succeeded',
          retryable: false,
          files: [csvFile('sales'), csvFile('inventory'), csvFile('financial')],
        };
      },
    });
    const id = await publishPilot(service);
    const queued = await service.start(memberCtx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'lease-renew',
    });
    expect(await service.execute(TENANT, queued.id)).toBe('done');
    expect((await store.findRun(TENANT, queued.id))?.status).toBe('completed');
  });

  it('records a confirmed send without resending and retries a missing send with a new key', async () => {
    const keys: string[] = [];
    let mode: 'uncertain' | 'ok' = 'uncertain';
    const { service } = setup({
      effect: {
        async propose(input) {
          keys.push(input.idempotencyKey);
          if (mode === 'uncertain') throw new EmailDeliveryUncertainError();
          return { status: 'completed', actionExecutionId: `exec-${keys.length}`, approvalId: null, output: { messageId: '<ok>' } };
        },
        async lookup() {
          return null;
        },
      },
    });
    const id = await publishPilot(service);
    const confirmed = await service.start(ctx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'reconcile-confirmed',
    });
    await service.execute(TENANT, confirmed.id);
    await service.reconcile(ctx(), id, confirmed.id, 'confirmed');
    expect(await service.execute(TENANT, confirmed.id)).toBe('done');
    const confirmedRun = await service.getRun(ctx(), id, confirmed.id);
    expect(confirmedRun.status).toBe('completed');
    expect(confirmedRun.steps.find((step) => step.key === 'send')?.reconciliation?.decision).toBe('confirmed');
    expect(keys).toHaveLength(1);

    mode = 'uncertain';
    const missing = await service.start(ctx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'reconcile-missing',
    });
    await service.execute(TENANT, missing.id);
    await service.reconcile(ctx(), id, missing.id, 'not_sent');
    mode = 'ok';
    await service.execute(TENANT, missing.id);
    expect(keys).toHaveLength(3);
    expect(keys[2]).not.toBe(keys[1]);
    expect(keys[2]?.endsWith(':send:1')).toBe(true);
    expect((await service.getRun(ctx(), id, missing.id)).steps.find((step) => step.key === 'send')?.reconciliation?.decision).toBe('not_sent');
  });

  it('isolates reconciliation and triggers by tenant', async () => {
    const { service, store } = setup({
      effect: {
        async propose() {
          throw new EmailDeliveryUncertainError();
        },
        async lookup() {
          return null;
        },
      },
    });
    const id = await publishPilot(service);
    const queued = await service.start(ctx(), {
      automationId: id,
      params: params(),
      origin: 'page',
      idempotencyKey: 'isolate',
    });
    await service.execute(TENANT, queued.id);
    await store.setEnabled('other', true);
    const outsider = ctx({ tenantId: 'other', userId: 'u2', operatorId: 'op2' });
    await expect(service.reconcile(outsider, id, queued.id, 'confirmed')).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    await expect(service.reconcile(memberCtx(), id, queued.id, 'not_sent')).rejects.toBeInstanceOf(AppError);
    const trigger = await service.createTrigger(ctx(), id, { kind: 'webhook' });
    await expect(service.setTriggerEnabled(outsider, id, trigger.id, false)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    await expect(service.get(outsider, id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('accepts more than one structured definition', async () => {
    const { service } = setup();
    const email = await service.createDraft(ctx(), 'notify.email');
    expect((await service.get(ctx(), email.id)).version?.steps.map((step) => step.kind)).toEqual(['send_email']);
    const custom = await service.createDraft(ctx(), {
      name: 'Dois passos',
      definition: {
        ...notifyEmailVersionBody({}),
        steps: [
          { key: 'validate', kind: 'validate_reports', retryable: true },
          { key: 'send', kind: 'send_email', retryable: false },
        ],
      },
    });
    expect((await service.get(ctx(), custom.id)).version?.steps).toHaveLength(2);
  });
});

describe('reports portal browser', () => {
  it('fails closed instead of synthesizing CSV files', async () => {
    let ran = false;
    const browser = createReportsPortalBrowser(
      { browserWorkflowRevision: { findFirst: async () => null } } as never,
      {
        async run() {
          ran = true;
          return { status: 'succeeded', retryable: false, files: [csvFile('sales')] };
        },
      },
    );
    const missing = await browser.execute({
      tenantId: TENANT,
      runId: 'run',
      connectionId: 'connection',
      workflowKey: 'tactia.reports-portal',
      workflowVersion: '1',
      revisionId: 'rev',
      parameters: {},
      signal: new AbortController().signal,
    });
    expect(missing.status).toBe('failed');
    expect(missing.files).toEqual([]);
    expect(ran).toBe(false);

    const delegated = createReportsPortalBrowser(
      {
        browserWorkflowRevision: {
          findFirst: async () => ({ id: 'rev', workflowVersion: '1', workflow: { workflowKey: 'tactia.reports-portal' } }),
        },
      } as never,
      {
        async run() {
          return { status: 'succeeded', retryable: false, files: [csvFile('sales')], externalExecutionId: 'remote' };
        },
      },
    );
    const found = await delegated.execute({
      tenantId: TENANT,
      runId: 'run',
      connectionId: 'connection',
      workflowKey: 'tactia.reports-portal',
      workflowVersion: '1',
      revisionId: 'rev',
      parameters: {},
      signal: new AbortController().signal,
    });
    expect(found.files.map((file) => file.name)).toEqual(['sales.csv']);
    expect(found.externalExecutionId).toBe('remote');
  });

  it('maps pending, approved and running email actions as in progress', () => {
    for (const status of ['pending', 'approved', 'running']) {
      expect(effectProposalFromAction({ id: 'e', status, error: null, output: null }).status).toBe('in_progress');
    }
    expect(effectProposalFromAction({ id: 'e', status: 'completed', error: null, output: { messageId: 'm' } }).status).toBe('completed');
    expect(
      effectProposalFromAction({ id: 'e', status: 'failed', error: 'EMAIL_DELIVERY_UNCERTAIN', output: null }).status,
    ).toBe('needs_attention');
  });
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
