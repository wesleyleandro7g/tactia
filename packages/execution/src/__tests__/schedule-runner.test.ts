/**
 * ScheduleRunner integration tests against a real Postgres.
 *
 * Covers:
 * - target=action, effectMode=auto_execute → runs without approval, records output
 * - repeatMode=count → schedule disables after maxOccurrences successes
 * - a failed occurrence records the error and does NOT count towards the cap
 * - target=ai_agent delegates to the ScheduleAgentRunner
 * - target=automation fails clearly when the runner is not wired
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { afterAll, describe, expect, it } from 'vitest';
import {
  ActionExecutionRepository,
  ActionRepository,
  ActivityRepository,
  ApprovalRepository,
  AuditLogRepository,
  CustomerRepository,
  LeadRepository,
  prisma,
  ScheduleOccurrenceRepository,
  ScheduleRepository,
  SellerRepository,
  TenantRepository,
} from '@tactia/database';
import { AuditLogService } from '@tactia/domain';
import { createId } from '@tactia/shared';
import { ActionRegistry } from '../action-registry';
import { createTaskAction } from '../actions/create-task';
import { sendEmailAction } from '../actions/send-email';
import { MemoryEmailSender } from '../email-sender';
import { ExecutionEngine } from '../execution-engine';
import { ScheduleRunner, type ScheduleAgentRunner } from '../schedule-runner';

const tenants = new TenantRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));
const schedules = new ScheduleRepository(prisma);
const occurrences = new ScheduleOccurrenceRepository(prisma);

const emailSender = new MemoryEmailSender();
const failingEmailSender = new MemoryEmailSender('smtp unreachable');

function buildEngine(sender: MemoryEmailSender) {
  return new ExecutionEngine({
    actions: new ActionRepository(prisma),
    executions: new ActionExecutionRepository(prisma),
    approvals: new ApprovalRepository(prisma),
    registry: new ActionRegistry([
      createTaskAction({
        activities: new ActivityRepository(prisma),
        customers: new CustomerRepository(prisma),
        leads: new LeadRepository(prisma),
        sellers: new SellerRepository(prisma),
      }),
      sendEmailAction({ emailSender: sender }),
    ]),
    auditLogs,
  });
}

const tenantIds: string[] = [];

async function makeTenant() {
  const id = createId();
  const tenant = await tenants.create({
    name: 'Schedule Runner Test',
    slug: `sched-runner-${id}`,
    timezone: 'America/Sao_Paulo',
    currency: 'BRL',
  });
  tenantIds.push(tenant.id);
  return tenant;
}

async function makeOccurrence(tenantId: string, scheduleId: string, periodKey: string) {
  const { occurrence } = await occurrences.createExclusive({ tenantId, scheduleId, periodKey });
  return occurrence;
}

afterAll(async () => {
  if (tenantIds.length) {
    await prisma.scheduleOccurrence.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.schedule.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.approval.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.actionExecution.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.action.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.$disconnect();
});

describe('ScheduleRunner', () => {
  it('runs an action target with auto_execute (no approval) and records output', async () => {
    const tenant = await makeTenant();
    const runner = new ScheduleRunner({ schedules, occurrences, engine: buildEngine(emailSender), auditLogs });
    const schedule = await schedules.create({
      tenantId: tenant.id,
      name: 'Envio automático',
      target: 'action',
      effectMode: 'auto_execute',
      frequency: 'daily',
      actionType: 'send_email',
      actionInput: { to: 'dono@empresa.com', subject: 'Olá', body: 'Corpo' },
    });
    const occurrence = await makeOccurrence(tenant.id, schedule.id, '2026-01-15');

    const result = await runner.run(tenant.id, occurrence.id);
    expect(result?.status).toBe('completed');
    expect(result?.actionExecutionId).toBeTruthy();
    expect(emailSender.sent.at(-1)?.to).toBe('dono@empresa.com');
  });

  it('disables a count-capped schedule after reaching maxOccurrences', async () => {
    const tenant = await makeTenant();
    const runner = new ScheduleRunner({ schedules, occurrences, engine: buildEngine(emailSender), auditLogs });
    const schedule = await schedules.create({
      tenantId: tenant.id,
      name: 'Duas vezes',
      target: 'action',
      effectMode: 'auto_execute',
      frequency: 'daily',
      repeatMode: 'count',
      maxOccurrences: 2,
      actionType: 'send_email',
      actionInput: { to: 'contato@empresa.com', subject: 's', body: 'b' },
    });

    const o1 = await makeOccurrence(tenant.id, schedule.id, 'p1');
    await runner.run(tenant.id, o1.id);
    let current = await schedules.findById({ tenantId: tenant.id, id: schedule.id });
    expect(current?.successCount).toBe(1);
    expect(current?.enabled).toBe(true);

    const o2 = await makeOccurrence(tenant.id, schedule.id, 'p2');
    await runner.run(tenant.id, o2.id);
    current = await schedules.findById({ tenantId: tenant.id, id: schedule.id });
    expect(current?.successCount).toBe(2);
    expect(current?.enabled).toBe(false);
  });

  it('records a failure without counting it towards the cap', async () => {
    const tenant = await makeTenant();
    const runner = new ScheduleRunner({
      schedules,
      occurrences,
      engine: buildEngine(failingEmailSender),
      auditLogs,
    });
    const schedule = await schedules.create({
      tenantId: tenant.id,
      name: 'Falha',
      target: 'action',
      effectMode: 'auto_execute',
      frequency: 'daily',
      repeatMode: 'count',
      maxOccurrences: 1,
      actionType: 'send_email',
      actionInput: { to: 'contato@empresa.com', subject: 's', body: 'b' },
    });
    const occurrence = await makeOccurrence(tenant.id, schedule.id, 'fail-1');

    const result = await runner.run(tenant.id, occurrence.id);
    // The underlying execution failed inside the engine; the runner surfaces
    // that as a failed occurrence, so it must NOT count towards the cap.
    const current = await schedules.findById({ tenantId: tenant.id, id: schedule.id });
    expect(result?.status).toBe('failed');
    expect(result?.error).toContain('smtp unreachable');
    expect(current?.successCount).toBe(0);
    expect(current?.enabled).toBe(true);
  });

  it('delegates ai_agent to the agent runner', async () => {
    const tenant = await makeTenant();
    let called = false;
    const agentRunner: ScheduleAgentRunner = {
      async run(input) {
        called = true;
        expect(input.aiConfig.instruction).toBe('Gere o briefing');
        expect(input.effectMode).toBe('propose');
        return { summary: 'ok', proposals: 0 };
      },
    };
    const runner = new ScheduleRunner({
      schedules,
      occurrences,
      engine: buildEngine(emailSender),
      auditLogs,
      agentRunner,
    });
    const schedule = await schedules.create({
      tenantId: tenant.id,
      name: 'Briefing IA',
      target: 'ai_agent',
      effectMode: 'propose',
      frequency: 'daily',
      aiConfig: { instruction: 'Gere o briefing' },
    });
    const occurrence = await makeOccurrence(tenant.id, schedule.id, '2026-01-15');

    const result = await runner.run(tenant.id, occurrence.id);
    expect(called).toBe(true);
    expect(result?.status).toBe('completed');
    expect(result?.output).toMatchObject({ summary: 'ok' });
  });

  it('fails automation target with a clear not-implemented error', async () => {
    const tenant = await makeTenant();
    const runner = new ScheduleRunner({ schedules, occurrences, engine: buildEngine(emailSender), auditLogs });
    const schedule = await schedules.create({
      tenantId: tenant.id,
      name: 'Automação futura',
      target: 'automation',
      frequency: 'daily',
    });
    const occurrence = await makeOccurrence(tenant.id, schedule.id, '2026-01-15');

    const result = await runner.run(tenant.id, occurrence.id);
    expect(result?.status).toBe('failed');
    expect(result?.error).toContain('Executor de automações não está configurado');
  });

  it('does not re-run a completed occurrence (idempotent)', async () => {
    const tenant = await makeTenant();
    const runner = new ScheduleRunner({ schedules, occurrences, engine: buildEngine(emailSender), auditLogs });
    const schedule = await schedules.create({
      tenantId: tenant.id,
      name: 'Idempotente',
      target: 'action',
      effectMode: 'auto_execute',
      frequency: 'daily',
      actionType: 'create_task',
      actionInput: { title: 'Tarefa agendada' },
    });
    const occurrence = await makeOccurrence(tenant.id, schedule.id, 'once');

    await runner.run(tenant.id, occurrence.id);
    const afterFirst = await schedules.findById({ tenantId: tenant.id, id: schedule.id });
    await runner.run(tenant.id, occurrence.id); // second run is a no-op
    const afterSecond = await schedules.findById({ tenantId: tenant.id, id: schedule.id });
    expect(afterSecond?.successCount).toBe(afterFirst?.successCount);
  });
});
