/**
 * Execution engine integration tests against a real Postgres.
 *
 * Covers the acceptance criteria of Etapa 7 / spec §59 (Execution):
 * - an action that requires approval does not run until approved
 * - approving runs it and records the output; rejecting cancels it
 * - executor failure is recorded with status `failed` + classified error
 * - a repeated Idempotency-Key never creates a second execution
 * - AI-originated proposals always wait for a human
 * - tenants are isolated
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ActionExecutionRepository,
  ActionRepository,
  ActivityRepository,
  ApprovalRepository,
  AuditLogRepository,
  CustomerRepository,
  EpisodeRepository,
  LeadRepository,
  MembershipRepository,
  prisma,
  SellerRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import { AuditLogService, EpisodeService } from '@tactia/domain';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { ActionRegistry } from '../action-registry';
import { ActionService } from '../action-service';
import { ApprovalService } from '../approval-service';
import { createTaskAction } from '../actions/create-task';
import { sendEmailAction } from '../actions/send-email';
import { MemoryEmailSender } from '../email-sender';
import { ExecutionEngine, type EpisodeSink } from '../execution-engine';

const TEST_SLUGS = ['exec-co', 'exec-other-co'];

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const auditLogRepository = new AuditLogRepository(prisma);
const auditLogs = new AuditLogService(auditLogRepository);
const episodeService = new EpisodeService(new EpisodeRepository(prisma));
const episodeSink: EpisodeSink = {
  record: async (input) => {
    await episodeService.record(input);
  },
};

const actionRepository = new ActionRepository(prisma);
const executionRepository = new ActionExecutionRepository(prisma);
const approvalRepository = new ApprovalRepository(prisma);
const activityRepository = new ActivityRepository(prisma);
const customerRepository = new CustomerRepository(prisma);
const leadRepository = new LeadRepository(prisma);
const sellerRepository = new SellerRepository(prisma);

const emailSender = new MemoryEmailSender();
const failingEmailSender = new MemoryEmailSender('smtp unreachable');

function buildRegistry(sender: MemoryEmailSender) {
  return new ActionRegistry([
    createTaskAction({
      activities: activityRepository,
      customers: customerRepository,
      leads: leadRepository,
      sellers: sellerRepository,
    }),
    sendEmailAction({ emailSender: sender }),
  ]);
}

function buildEngine(sender: MemoryEmailSender = emailSender, episodes?: EpisodeSink) {
  return new ExecutionEngine({
    actions: actionRepository,
    executions: executionRepository,
    approvals: approvalRepository,
    registry: buildRegistry(sender),
    auditLogs,
    ...(episodes ? { episodes } : {}),
  });
}

const engine = buildEngine();
const actionService = new ActionService(
  actionRepository,
  executionRepository,
  buildRegistry(emailSender),
  auditLogs,
);
const approvalService = new ApprovalService(approvalRepository, engine);

let ownerCtx: RequestContext;
let memberCtx: RequestContext;
let otherTenantCtx: RequestContext;
let tenantId: string;
let customerId: string;

function context(
  partial: Pick<RequestContext, 'tenantId' | 'userId' | 'role'>,
): RequestContext {
  return { requestId: createId(), ip: '127.0.0.1', ...partial };
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: TEST_SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;

  await prisma.episode.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.approval.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.actionExecution.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.action.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.seller.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });

  const authUsers = await prisma.authUser.findMany({
    where: { email: { endsWith: '@exec.local' } },
  });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function createUser(name: string) {
  const auth = await prisma.authUser.create({
    data: { id: createId(), name, email: `${name}@exec.local`, emailVerified: true },
  });
  return users.create({ externalAuthId: auth.id, name, email: `${name}@exec.local` });
}

/** Cleans executions/approvals between tests, keeping tenants and users. */
async function resetExecutions() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: TEST_SLUGS } } });
  const ids = rows.map((row) => row.id);
  await prisma.episode.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.approval.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.actionExecution.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.action.deleteMany({ where: { tenantId: { in: ids } } });
  emailSender.sent.length = 0;
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();

  const tenant = await tenants.create({ name: 'exec-co', slug: 'exec-co' });
  const otherTenant = await tenants.create({ name: 'exec-other-co', slug: 'exec-other-co' });
  tenantId = tenant.id;

  const owner = await createUser('owner');
  const member = await createUser('member');
  const outsider = await createUser('outsider');

  await memberships.create({ tenantId: tenant.id, userId: owner.id, role: 'owner' });
  await memberships.create({ tenantId: tenant.id, userId: member.id, role: 'member' });
  await memberships.create({ tenantId: otherTenant.id, userId: outsider.id, role: 'owner' });

  ownerCtx = context({ tenantId: tenant.id, userId: owner.id, role: 'owner' });
  memberCtx = context({ tenantId: tenant.id, userId: member.id, role: 'member' });
  otherTenantCtx = context({ tenantId: otherTenant.id, userId: outsider.id, role: 'owner' });

  customerId = (await customerRepository.create({ tenantId, name: 'Cliente Alfa' })).id;
});

beforeEach(async () => {
  await resetExecutions();
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('ActionRegistry', () => {
  it('exposes only the action types with an executor', () => {
    expect(buildRegistry(emailSender).types().sort()).toEqual(['create_task', 'send_email']);
  });

  it('rejects a type without an executor', () => {
    expect(() => buildRegistry(emailSender).get('send_whatsapp')).toThrowError(
      /não é suportada/,
    );
  });

  it('validates input against the action schema', () => {
    expect(() => buildRegistry(emailSender).validate('send_email', { to: 'not-an-email' })).toThrow();
    expect(
      buildRegistry(emailSender).validate('create_task', { title: 'Ligar para o cliente' }),
    ).toMatchObject({ title: 'Ligar para o cliente' });
  });
});

describe('ExecutionEngine', () => {
  it('parks an action that requires approval and does not execute it', async () => {
    const execution = await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Ligar para o Cliente Alfa', customerId },
    });

    expect(execution.status).toBe('awaiting_approval');
    expect(execution.startedAt).toBeNull();
    expect(execution.output).toBeNull();
    expect(execution.approvals).toHaveLength(1);
    expect(execution.approvals[0]?.status).toBe('pending');

    // Nothing was created in the business data yet
    const tasks = await prisma.activity.count({ where: { tenantId, type: 'task' } });
    expect(tasks).toBe(0);

    // Running it directly is refused while it waits for a human
    await expect(engine.run(tenantId, execution.id)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
  });

  it('executes after approval and records the full trail', async () => {
    const proposed = await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Enviar proposta', customerId },
      reason: 'Cliente pediu retorno',
    });
    const approvalId = proposed.approvals[0]!.id;

    const executed = await approvalService.approve(ownerCtx, approvalId, { reason: 'ok' });

    expect(executed.status).toBe('completed');
    expect(executed.startedAt).not.toBeNull();
    expect(executed.finishedAt).not.toBeNull();
    expect(executed.error).toBeNull();

    const output = executed.output as { activityId: string; title: string };
    expect(output.title).toBe('Enviar proposta');

    const activity = await prisma.activity.findUnique({ where: { id: output.activityId } });
    expect(activity?.type).toBe('task');
    expect(activity?.customerId).toBe(customerId);
    expect(activity?.metadata).toMatchObject({
      title: 'Enviar proposta',
      source: 'action',
      actionExecutionId: executed.id,
    });

    const approval = await approvalRepository.findById({ tenantId, id: approvalId });
    expect(approval?.status).toBe('approved');
    expect(approval?.approvedBy).toBe(ownerCtx.userId);
    expect(approval?.resolvedAt).not.toBeNull();

    const audit = await auditLogRepository.list({ tenantId, skip: 0, take: 50 });
    const actions = audit.items.map((entry) => entry.action);
    expect(actions).toContain('ACTION_PROPOSED');
    expect(actions).toContain('ACTION_APPROVED');
    expect(actions).toContain('ACTION_EXECUTED');
  });

  it('cancels the execution when the approval is rejected', async () => {
    const proposed = await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Tarefa que não deve rodar' },
    });

    const rejected = await approvalService.reject(ownerCtx, proposed.approvals[0]!.id, {
      reason: 'Não faz sentido agora',
    });

    expect(rejected.status).toBe('cancelled');
    expect(await prisma.activity.count({ where: { tenantId, type: 'task' } })).toBe(0);

    const approval = await approvalRepository.findById({
      tenantId,
      id: proposed.approvals[0]!.id,
    });
    expect(approval?.status).toBe('rejected');
    expect(approval?.reason).toBe('Não faz sentido agora');

    const audit = await auditLogRepository.list({ tenantId, skip: 0, take: 50 });
    expect(audit.items.map((entry) => entry.action)).toContain('ACTION_REJECTED');
  });

  it('runs immediately when the action does not require approval', async () => {
    await actionRepository.create({
      tenantId,
      type: 'send_email',
      name: 'Enviar e-mail',
      configuration: { defaultCc: ['gestor@exec.local'] },
      requiresApproval: false,
    });

    const execution = await engine.propose(memberCtx, {
      actionType: 'send_email',
      input: { to: 'cliente@exec.local', subject: 'Olá', body: 'Mensagem de teste' },
    });

    expect(execution.status).toBe('completed');
    expect(execution.approvals).toHaveLength(0);

    const output = execution.output as { messageId: string; driver: string; cc?: string[] };
    expect(output.driver).toBe('memory');
    expect(output.cc).toEqual(['gestor@exec.local']);
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.to).toBe('cliente@exec.local');
  });

  it('records executor failures as status failed with a classified error', async () => {
    const failingEngine = buildEngine(failingEmailSender);

    await actionRepository.create({
      tenantId,
      type: 'send_email',
      name: 'Enviar e-mail',
      configuration: {},
      requiresApproval: false,
    });

    const execution = await failingEngine.propose(memberCtx, {
      actionType: 'send_email',
      input: { to: 'cliente@exec.local', subject: 'Falha', body: 'Deve falhar' },
    });

    expect(execution.status).toBe('failed');
    expect(execution.error).toContain('smtp unreachable');
    expect(execution.finishedAt).not.toBeNull();

    const audit = await auditLogRepository.list({ tenantId, skip: 0, take: 50 });
    expect(audit.items.map((entry) => entry.action)).toContain('ACTION_FAILED');
  });

  it('records a failure when the action references data from another tenant', async () => {
    const foreignCustomer = await customerRepository.create({
      tenantId: otherTenantCtx.tenantId!,
      name: 'Cliente de outro tenant',
    });

    await actionRepository.create({
      tenantId,
      type: 'create_task',
      name: 'Criar tarefa',
      configuration: {},
      requiresApproval: false,
    });

    const execution = await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Tarefa cruzada', customerId: foreignCustomer.id },
    });

    expect(execution.status).toBe('failed');
    expect(execution.error).toContain('NOT_FOUND');
    expect(await prisma.activity.count({ where: { tenantId, type: 'task' } })).toBe(0);
  });

  it('rejects an input that does not satisfy the action schema', async () => {
    await expect(
      engine.propose(memberCtx, { actionType: 'send_email', input: { to: 'nope' } }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    // Nothing persisted for an invalid proposal
    expect(await prisma.actionExecution.count({ where: { tenantId } })).toBe(0);
  });

  it('does not duplicate executions for a repeated Idempotency-Key', async () => {
    const first = await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Tarefa idempotente' },
      idempotencyKey: 'key-123',
    });
    const second = await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Tarefa idempotente (retry)' },
      idempotencyKey: 'key-123',
    });

    expect(second.id).toBe(first.id);
    expect(await prisma.actionExecution.count({ where: { tenantId } })).toBe(1);

    // The same key in another tenant is a different execution
    const other = await engine.propose(otherTenantCtx, {
      actionType: 'create_task',
      input: { title: 'Outro tenant' },
      idempotencyKey: 'key-123',
    });
    expect(other.id).not.toBe(first.id);
  });

  it('refuses to run the same execution twice', async () => {
    await actionRepository.create({
      tenantId,
      type: 'create_task',
      name: 'Criar tarefa',
      configuration: {},
      requiresApproval: false,
    });

    const execution = await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Executa uma vez' },
    });
    expect(execution.status).toBe('completed');

    await expect(engine.run(tenantId, execution.id)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
    expect(await prisma.activity.count({ where: { tenantId, type: 'task' } })).toBe(1);
  });

  it('cancels a pending proposal and resolves its approval', async () => {
    const proposed = await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Vai ser cancelada' },
    });

    const cancelled = await engine.cancel(memberCtx, proposed.id, 'Mudei de ideia');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.approvals[0]?.status).toBe('rejected');

    await expect(engine.cancel(memberCtx, proposed.id)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
  });

  it('always requires approval for AI-originated proposals', async () => {
    // Even with an action configured to skip approval
    await actionRepository.create({
      tenantId,
      type: 'create_task',
      name: 'Criar tarefa',
      configuration: {},
      requiresApproval: false,
    });

    const proposal = await engine.proposeFromAi(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Tarefa sugerida pela IA' },
      reason: 'Cliente inativo há 40 dias',
    });

    expect(proposal.status).toBe('awaiting_approval');
    expect(proposal.requiresApproval).toBe(true);
    expect(proposal.approvalId).not.toBeNull();
    expect(await prisma.activity.count({ where: { tenantId, type: 'task' } })).toBe(0);

    const execution = await actionService.getExecution(memberCtx, proposal.id);
    expect(execution.origin).toBe('ai');

    const audit = await auditLogRepository.list({ tenantId, skip: 0, take: 50 });
    const proposedEntry = audit.items.find((entry) => entry.action === 'ACTION_PROPOSED');
    expect(proposedEntry?.actorType).toBe('ai');
  });

  it('rejects an unsupported action type coming from the AI', async () => {
    await expect(
      engine.proposeFromAi(memberCtx, { actionType: 'send_whatsapp', input: {} }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('enforces roles: viewer cannot propose, member cannot approve', async () => {
    const viewerCtx = context({ tenantId, userId: memberCtx.userId, role: 'viewer' });
    await expect(
      engine.propose(viewerCtx, { actionType: 'create_task', input: { title: 'Nope' } }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORIZATION_ERROR });

    const proposed = await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Precisa de admin' },
    });
    await expect(
      approvalService.approve(memberCtx, proposed.approvals[0]!.id),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORIZATION_ERROR });
  });

  it('isolates tenants across executions and approvals', async () => {
    const proposed = await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Só do tenant A' },
    });

    await expect(
      actionService.getExecution(otherTenantCtx, proposed.id),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    await expect(
      approvalService.approve(otherTenantCtx, proposed.approvals[0]!.id),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    await expect(engine.run(otherTenantCtx.tenantId!, proposed.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });

    const otherQueue = await approvalService.list(otherTenantCtx, {});
    expect(otherQueue.total).toBe(0);
  });

  it('provisions the action definition on first use', async () => {
    expect(await prisma.action.count({ where: { tenantId, type: 'create_task' } })).toBe(0);

    await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Provisiona a definição' },
    });

    const action = await actionRepository.findByType({ tenantId, type: 'create_task' });
    expect(action?.requiresApproval).toBe(true);
    expect(action?.enabled).toBe(true);
  });

  it('refuses to propose a disabled action', async () => {
    const action = await actionRepository.create({
      tenantId,
      type: 'create_task',
      name: 'Criar tarefa',
      configuration: {},
      enabled: false,
    });

    await expect(
      engine.propose(memberCtx, { actionId: action.id, input: { title: 'Desativada' } }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });
});

describe('ActionService', () => {
  it('seeds the built-in definitions once', async () => {
    const first = await actionService.seedDefaults(ownerCtx);
    expect(first.created.sort()).toEqual(['create_task', 'send_email']);

    const second = await actionService.seedDefaults(ownerCtx);
    expect(second.created).toEqual([]);
    expect(await prisma.action.count({ where: { tenantId } })).toBe(2);
  });

  it('lists the catalog together with the executable types', async () => {
    await actionService.seedDefaults(ownerCtx);
    const page = await actionService.list(ownerCtx, {});

    expect(page.total).toBe(2);
    expect(page.available.map((definition) => definition.type).sort()).toEqual([
      'create_task',
      'send_email',
    ]);
  });

  it('blocks cataloguing a type without an executor', async () => {
    await expect(
      actionService.create(ownerCtx, { type: 'generate_report' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('blocks a duplicated type and requires admin to mutate', async () => {
    await actionService.create(ownerCtx, { type: 'create_task' });
    await expect(actionService.create(ownerCtx, { type: 'create_task' })).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
    await expect(actionService.create(memberCtx, { type: 'send_email' })).rejects.toMatchObject({
      code: ErrorCode.AUTHORIZATION_ERROR,
    });
  });

  it('filters executions by status', async () => {
    await engine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Aguardando' },
    });

    const awaiting = await actionService.listExecutions(memberCtx, {
      status: 'awaiting_approval',
    });
    expect(awaiting.total).toBe(1);

    const completed = await actionService.listExecutions(memberCtx, { status: 'completed' });
    expect(completed.total).toBe(0);
  });
});

describe('E15 episodic memory', () => {
  const memoryEngine = buildEngine(emailSender, episodeSink);
  const memoryApprovals = new ApprovalService(approvalRepository, memoryEngine);

  it('E15: approve writes episode outcome approved with deterministic text', async () => {
    const proposed = await memoryEngine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Ligar para o Cliente Alfa', customerId },
      reason: 'Cliente pediu retorno',
    });
    await memoryApprovals.approve(ownerCtx, proposed.approvals[0]!.id, { reason: 'ok' });

    const episodes = await prisma.episode.findMany({
      where: { tenantId, actionExecutionId: proposed.id, outcome: 'approved' },
    });
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.kind).toBe('decision');
    expect(episodes[0]?.text).toContain('Proposta create_task');
    expect(episodes[0]?.text).toContain('approved');
    expect(episodes[0]?.text).toContain('Cliente pediu retorno');
    expect(episodes[0]?.text).toContain('Tarefa: Ligar para o Cliente Alfa');
  });

  it('E15: reject writes episode outcome rejected', async () => {
    const proposed = await memoryEngine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Tarefa que não deve rodar' },
      reason: 'Tentativa de desconto',
    });
    await memoryApprovals.reject(ownerCtx, proposed.approvals[0]!.id, {
      reason: 'Não faz sentido agora',
    });

    const episodes = await prisma.episode.findMany({
      where: { tenantId, actionExecutionId: proposed.id, outcome: 'rejected' },
    });
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.kind).toBe('decision');
    expect(episodes[0]?.text).toContain('rejected');
  });

  it('E15: run success writes episode executed', async () => {
    await actionRepository.create({
      tenantId,
      type: 'create_task',
      name: 'Criar tarefa',
      configuration: {},
      requiresApproval: false,
    });
    const execution = await memoryEngine.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Executa uma vez' },
    });
    expect(execution.status).toBe('completed');

    const first = await prisma.episode.count({
      where: { tenantId, actionExecutionId: execution.id, outcome: 'executed' },
    });
    expect(first).toBe(1);

    await episodeSink.record({
      tenantId,
      kind: 'action_outcome',
      outcome: 'executed',
      text: 'duplicata',
      actionExecutionId: execution.id,
      occurredAt: new Date(),
    });
    expect(
      await prisma.episode.count({
        where: { tenantId, actionExecutionId: execution.id, outcome: 'executed' },
      }),
    ).toBe(1);
  });

  it('E15: episode sink failure does not fail approve', async () => {
    const throwing: EpisodeSink = {
      async record() {
        throw new Error('sink down');
      },
    };
    const fragile = buildEngine(emailSender, throwing);
    const proposed = await fragile.propose(memberCtx, {
      actionType: 'create_task',
      input: { title: 'Aprovar mesmo com sink quebrado' },
    });
    const executed = await new ApprovalService(approvalRepository, fragile).approve(
      ownerCtx,
      proposed.approvals[0]!.id,
    );
    expect(executed.status).toBe('completed');
  });
});
