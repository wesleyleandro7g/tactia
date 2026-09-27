/**
 * Schedule chat tools — schema validation, role gating and port delegation.
 * No database and no LLM; the SchedulePort is a fake.
 */

import { describe, expect, it } from 'vitest';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { ToolRegistry } from '../tool-registry';
import { createScheduleTools, type SchedulePort } from '../tools/schedule';
import type { ToolContext } from '../types';

function toolContext(role: RequestContext['role'] = 'admin'): ToolContext {
  return {
    requestId: createId(),
    tenantId: 'tenant-1',
    userId: 'user-1',
    role,
    ip: '127.0.0.1',
  } as ToolContext;
}

function fakePort() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const port: SchedulePort = {
    async create(_ctx, input) {
      calls.push({ method: 'create', args: [input] });
      return { id: 'sch-1', name: (input as { name: string }).name, enabled: true };
    },
    async list(_ctx, query) {
      calls.push({ method: 'list', args: [query] });
      return {
        items: [{ id: 'sch-1', name: 'Briefing', target: 'ai_agent', frequency: 'daily', enabled: true }],
        total: 1,
      };
    },
    async update(_ctx, id, input) {
      calls.push({ method: 'update', args: [id, input] });
      return { id, name: 'Atualizado', enabled: true };
    },
    async setEnabled(_ctx, id, enabled) {
      calls.push({ method: 'setEnabled', args: [id, enabled] });
      return { id, enabled };
    },
    async triggerNow(_ctx, id) {
      calls.push({ method: 'triggerNow', args: [id] });
      return { id: 'occ-1', status: 'pending', periodKey: 'manual:2026-01-15' };
    },
  };
  return { port, calls };
}

function registryFor(port: SchedulePort) {
  return new ToolRegistry(createScheduleTools(port));
}

describe('schedule tools', () => {
  it('create_schedule creates an ai_agent schedule and confirms', async () => {
    const { port, calls } = fakePort();
    const registry = registryFor(port);

    const result = await registry.execute('create_schedule', toolContext(), {
      name: 'Briefing diário',
      target: 'ai_agent',
      frequency: 'daily',
      recurrenceConfig: { localTime: '08:00' },
      aiConfig: { instruction: 'Gere o briefing do dia' },
    });

    const data = result.data as Record<string, unknown>;
    expect(data.scheduleId).toBe('sch-1');
    expect(String(data.message)).toContain('criado');
    expect(calls[0]?.method).toBe('create');
  });

  it('list_schedules returns the tenant schedules', async () => {
    const { port } = fakePort();
    const registry = registryFor(port);
    const result = await registry.execute('list_schedules', toolContext('member'), {});
    const data = result.data as { total: number; schedules: unknown[] };
    expect(data.total).toBe(1);
    expect(data.schedules).toHaveLength(1);
  });

  it('update_schedule forwards the id and patch', async () => {
    const { port, calls } = fakePort();
    const registry = registryFor(port);
    await registry.execute('update_schedule', toolContext(), {
      scheduleId: 'sch-1',
      name: 'Novo nome',
    });
    expect(calls[0]?.method).toBe('update');
    expect(calls[0]?.args[0]).toBe('sch-1');
    expect(calls[0]?.args[1]).toMatchObject({ name: 'Novo nome' });
  });

  it('disable_schedule defaults to disabling', async () => {
    const { port, calls } = fakePort();
    const registry = registryFor(port);
    const result = await registry.execute('disable_schedule', toolContext(), { scheduleId: 'sch-1' });
    expect(calls[0]).toMatchObject({ method: 'setEnabled', args: ['sch-1', false] });
    expect(String((result.data as Record<string, unknown>).message)).toContain('desativado');
  });

  it('trigger_schedule fires a manual occurrence', async () => {
    const { port, calls } = fakePort();
    const registry = registryFor(port);
    const result = await registry.execute('trigger_schedule', toolContext(), { scheduleId: 'sch-1' });
    expect(calls[0]).toMatchObject({ method: 'triggerNow', args: ['sch-1'] });
    expect((result.data as Record<string, unknown>).occurrenceId).toBe('occ-1');
  });

  it('rejects invalid create input (missing target)', async () => {
    const { port } = fakePort();
    const registry = registryFor(port);
    await expect(
      registry.execute('create_schedule', toolContext(), { name: 'x', frequency: 'daily' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('mutations require the admin role', async () => {
    const { port } = fakePort();
    const registry = registryFor(port);
    await expect(
      registry.execute('create_schedule', toolContext('member'), {
        name: 'x',
        target: 'ai_agent',
        frequency: 'daily',
        aiConfig: { instruction: 'y' },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORIZATION_ERROR });
  });

  it('list_schedules is available to members', async () => {
    const { port } = fakePort();
    const registry = registryFor(port);
    const names = registry.names('member');
    expect(names).toContain('list_schedules');
    expect(names).not.toContain('create_schedule');
  });
});
