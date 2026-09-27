import { describe, expect, it, vi } from 'vitest';
import { BrowserAutomationRepository } from '../repositories/browser-automation-repository';

function repository() {
  const db = {
    browserAutomationTask: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    browserAutomationArtifact: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => data),
    },
    browserAutomationActionLog: {
      create: vi.fn().mockImplementation(async ({ data }) => data),
    },
    tenant: {
      findUnique: vi.fn().mockResolvedValue({ browserAgentSkillMarkdown: '# Regras\nSempre valide o tenant.' }),
      update: vi.fn().mockImplementation(async ({ data }) => data),
    },
  };
  return { db, repo: new BrowserAutomationRepository(db as never) };
}

describe('BrowserAutomationRepository tenant isolation', () => {
  it('scopes task and artifact reads to the authenticated tenant', async () => {
    const { db, repo } = repository();

    await repo.findTask('tenant-a', 'task-1');
    await repo.findArtifact('tenant-b', 'artifact-1');

    expect(db.browserAutomationTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-a', id: 'task-1' },
      }),
    );
    expect(db.browserAutomationArtifact.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-b', id: 'artifact-1' },
    });
  });

  it('claims a queued task atomically so concurrent workers cannot both run it', async () => {
    const { db, repo } = repository();

    await expect(repo.claimTask('tenant-a', 'task-1')).resolves.toBe(true);
    expect(db.browserAutomationTask.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', id: 'task-1', status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: expect.any(Date) },
    });

    db.browserAutomationTask.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repo.claimTask('tenant-a', 'task-1')).resolves.toBe(false);
  });

  it('cancels only active tasks and keeps the operation tenant-scoped', async () => {
    const { db, repo } = repository();

    await expect(repo.cancelTask('tenant-a', 'task-1')).resolves.toBe(true);
    expect(db.browserAutomationTask.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        id: 'task-1',
        status: { in: ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'] },
      },
      data: {
        status: 'CANCELLED',
        safeError: null,
        pendingAction: expect.anything(),
        approvalExecutionId: null,
        finishedAt: expect.any(Date),
      },
    });
  });

  it('persists artifacts with their tenant, task and session ownership', async () => {
    const { db, repo } = repository();
    await repo.createArtifact({
      tenantId: 'tenant-a',
      taskId: 'task-1',
      sessionId: 'session-1',
      type: 'DOWNLOAD',
      filename: 'report.csv',
      mimeType: 'text/csv',
      storageKey: 'tenant-a/browser-artifact/object.csv',
      byteSize: 100,
    });

    expect(db.browserAutomationArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        tenantId: 'tenant-a',
        taskId: 'task-1',
        sessionId: 'session-1',
      }),
    });
  });

  it('scopes global skills to the tenant', async () => {
    const { db, repo } = repository();

    await expect(repo.tenantSkillMarkdown('tenant-a')).resolves.toBe('# Regras\nSempre valide o tenant.');
    expect(db.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-a' },
      select: { browserAgentSkillMarkdown: true },
    });
  });

  it('records a legacy retirement reason when cancelling', async () => {
    const { db, repo } = repository();

    await repo.cancelTask('tenant-a', 'task-1', 'Execução antiga.');
    expect(db.browserAutomationTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED', safeError: 'Execução antiga.' }),
      }),
    );
  });

  it('only writes a terminal status while the worker still owns the task', async () => {
    const { db, repo } = repository();

    await expect(
      repo.finishTask('tenant-a', 'task-1', { status: 'COMPLETED', stepCount: 3 }),
    ).resolves.toBe(true);
    expect(db.browserAutomationTask.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', id: 'task-1', status: { in: ['RUNNING'] } },
      data: { status: 'COMPLETED', stepCount: 3, finishedAt: expect.any(Date) },
    });

    // A task cancelled by the user no longer matches `RUNNING`, so it is never overwritten.
    db.browserAutomationTask.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repo.finishTask('tenant-a', 'task-1', { status: 'FAILED', safeError: 'x' }),
    ).resolves.toBe(false);
  });

  it('loads at most the 50 most recent action logs without action input', async () => {
    const { db, repo } = repository();

    await repo.findTask('tenant-a', 'task-1');
    const args = db.browserAutomationTask.findFirst.mock.calls[0]![0] as {
      include: { actionLogs: { select: Record<string, boolean>; take: number } };
    };
    expect(args.include.actionLogs.take).toBe(50);
    expect(args.include.actionLogs.select).not.toHaveProperty('actionInput');
    expect(args.include.actionLogs.select).not.toHaveProperty('result');
  });
});
