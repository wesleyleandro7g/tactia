import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient } from '../client';
import { asJson } from '../json';

export class BrowserAutomationRepository {
  constructor(private readonly db: PrismaClient) {}

  listProfiles(tenantId: string, includeLegacySkill = false) {
    const base = { id: true, name: true, startUrl: true, allowedDomains: true, credentialId: true, lastUsedAt: true, createdAt: true } as const;
    return this.db.browserAutomationProfile.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      select: includeLegacySkill ? { ...base, skillMarkdown: true } : base,
    });
  }

  async tenantSkillMarkdown(tenantId: string) {
    const tenant = await this.db.tenant.findUnique({
      where: { id: tenantId },
      select: { browserAgentSkillMarkdown: true },
    });
    return tenant?.browserAgentSkillMarkdown ?? '';
  }

  updateTenantSkillMarkdown(tenantId: string, browserAgentSkillMarkdown: string) {
    return this.db.tenant.update({
      where: { id: tenantId },
      data: { browserAgentSkillMarkdown },
      select: { browserAgentSkillMarkdown: true },
    });
  }

  findProfile(tenantId: string, id: string) {
    return this.db.browserAutomationProfile.findFirst({ where: { tenantId, id } });
  }

  createProfile(input: { tenantId: string; name: string; startUrl: string; allowedDomains: string[]; skillMarkdown?: string; credentialId?: string | null }) {
    return this.db.browserAutomationProfile.create({
      data: { id: createId(), ...input, credentialId: input.credentialId ?? null },
    });
  }

  async updateProfile(tenantId: string, id: string, data: { name?: string; startUrl?: string; allowedDomains?: string[]; skillMarkdown?: string; credentialId?: string | null }) {
    const result = await this.db.browserAutomationProfile.updateMany({ where: { tenantId, id }, data });
    return result.count ? this.findProfile(tenantId, id) : null;
  }

  createTask(input: { tenantId: string; profileId: string; objective: string; conversationId?: string | null; requestedBy?: string | null }) {
    return this.db.browserAutomationTask.create({
      data: { id: createId(), ...input, conversationId: input.conversationId ?? null, requestedBy: input.requestedBy ?? null },
    });
  }

  findTask(tenantId: string, id: string) {
    return this.db.browserAutomationTask.findFirst({
      where: { tenantId, id },
      include: {
        artifacts: {
          select: { id: true, filename: true, mimeType: true, type: true, byteSize: true },
          orderBy: { createdAt: 'asc' },
        },
        resultMessage: {
          select: { id: true, content: true, metadata: true },
        },
        actionLogs: {
          select: { id: true, actionType: true, status: true, errorCode: true, urlAfter: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
  }

  async taskStatus(tenantId: string, id: string) {
    const task = await this.db.browserAutomationTask.findFirst({
      where: { tenantId, id },
      select: { status: true },
    });
    return task?.status ?? null;
  }

  /** Cancels an active task (tenant-scoped); returns `false` if it was already terminal. */
  async cancelTask(tenantId: string, id: string, safeError: string | null = null) {
    const result = await this.db.browserAutomationTask.updateMany({
      where: { tenantId, id, status: { in: ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'] } },
      data: {
        status: 'CANCELLED',
        safeError,
        pendingAction: Prisma.DbNull,
        approvalExecutionId: null,
        finishedAt: new Date(),
      },
    });
    return result.count === 1;
  }

  /**
   * Writes a terminal status only while the worker still owns the task
   * (`RUNNING`). A task cancelled by the user is never overwritten.
   */
  async finishTask(
    tenantId: string,
    id: string,
    data: {
      status: 'COMPLETED' | 'FAILED';
      safeError?: string | null;
      result?: Prisma.InputJsonValue;
      stepCount?: number;
    },
    fromStatuses: string[] = ['RUNNING'],
  ) {
    const result = await this.db.browserAutomationTask.updateMany({
      where: { tenantId, id, status: { in: fromStatuses } },
      data: { ...data, finishedAt: new Date() },
    });
    return result.count === 1;
  }

  async claimTask(tenantId: string, id: string) {
    const result = await this.db.browserAutomationTask.updateMany({
      where: { tenantId, id, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    return result.count === 1;
  }

  updateTask(tenantId: string, id: string, data: Parameters<PrismaClient['browserAutomationTask']['updateMany']>[0]['data']) {
    return this.db.browserAutomationTask.updateMany({ where: { tenantId, id }, data });
  }

  createSession(input: { id: string; tenantId: string; taskId: string; profileId: string; runtimeId: string; expiresAt: Date }) {
    return this.db.browserAutomationSession.create({ data: input });
  }

  findSession(tenantId: string, taskId: string) {
    return this.db.browserAutomationSession.findFirst({ where: { tenantId, taskId }, orderBy: { createdAt: 'desc' } });
  }

  updateSession(tenantId: string, id: string, data: Parameters<PrismaClient['browserAutomationSession']['updateMany']>[0]['data']) {
    return this.db.browserAutomationSession.updateMany({ where: { tenantId, id }, data });
  }

  expiredSessions(now: Date) {
    return this.db.browserAutomationSession.findMany({ where: { status: 'ACTIVE', expiresAt: { lte: now } }, take: 100 });
  }

  saveProfileState(tenantId: string, id: string, encryptedState: string) {
    return this.db.browserAutomationProfile.updateMany({
      where: { tenantId, id },
      data: { encryptedState, lastUsedAt: new Date() },
    });
  }

  createArtifact(input: { tenantId: string; taskId: string; sessionId: string; type: string; filename: string; mimeType: string; storageKey: string; byteSize: number }) {
    return this.db.browserAutomationArtifact.create({ data: { id: createId(), ...input } });
  }

  findArtifact(tenantId: string, id: string) {
    return this.db.browserAutomationArtifact.findFirst({ where: { tenantId, id } });
  }

  logAction(input: { tenantId: string; taskId: string; sessionId: string; actionType: string; actionInput?: object | null; result?: object | null; urlBefore?: string | null; urlAfter?: string | null; durationMs: number; status: string; errorCode?: string | null }) {
    return this.db.browserAutomationActionLog.create({ data: { id: createId(), ...input, actionInput: input.actionInput ? asJson(input.actionInput) as never : undefined, result: input.result ? asJson(input.result) as never : undefined } });
  }
}
