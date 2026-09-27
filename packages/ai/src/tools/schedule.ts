import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool, ToolContext } from '../types';

/**
 * Port implemented by the app layer against the domain `ScheduleService`,
 * keeping `@tactia/ai` free of any dependency on the domain/execution packages.
 * The assistant creates/manages schedules directly (self-service): a schedule is
 * configuration, not an external side effect. Any effect the schedule fires
 * later is still governed by its own `effectMode`.
 */
export type SchedulePort = {
  create(ctx: ToolContext, input: unknown): Promise<{ id: string; name: string; enabled: boolean }>;
  list(
    ctx: ToolContext,
    query: { enabled?: boolean },
  ): Promise<{ items: Array<{ id: string; name: string; target: string; frequency: string; enabled: boolean }>; total: number }>;
  update(ctx: ToolContext, id: string, input: unknown): Promise<{ id: string; name: string; enabled: boolean }>;
  setEnabled(ctx: ToolContext, id: string, enabled: boolean): Promise<{ id: string; enabled: boolean }>;
  triggerNow(ctx: ToolContext, id: string): Promise<{ id: string; status: string; periodKey: string }>;
};

const recurrenceConfigSchema = z
  .object({
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    nthBusinessDay: z.number().int().min(1).max(23).optional(),
    localTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  })
  .strict();

const aiConfigSchema = z
  .object({
    systemPrompt: z.string().trim().max(8_000).optional(),
    instruction: z.string().trim().min(1).max(8_000),
    tools: z.array(z.string().trim().min(1)).optional(),
    skillIds: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const createInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120).describe('Nome do agendamento.'),
    description: z.string().trim().max(500).optional(),
    target: z
      .enum(['ai_agent', 'action', 'automation'])
      .describe('ai_agent (roda o agente), action (ação do catálogo) ou automation (ainda não suportado).'),
    effectMode: z
      .enum(['propose', 'auto_execute'])
      .optional()
      .describe('propose = efeitos vão para aprovação; auto_execute = executa sem aprovação. Padrão: propose.'),
    frequency: z
      .enum(['daily', 'weekly', 'monthly', 'custom', 'manual'])
      .describe('Frequência. custom exige cronExpression; manual só dispara sob demanda.'),
    recurrenceConfig: recurrenceConfigSchema
      .optional()
      .describe('Detalhes: weekdays[0-6], dayOfMonth, nthBusinessDay, localTime "HH:mm".'),
    cronExpression: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    repeatMode: z.enum(['infinite', 'count']).optional().describe('infinite ou count (exige maxOccurrences).'),
    maxOccurrences: z.number().int().min(1).max(10_000).optional(),
    aiConfig: aiConfigSchema.optional().describe('Obrigatório para target=ai_agent: { instruction, systemPrompt?, tools?, skillIds? }.'),
    actionType: z
      .enum(['create_task', 'send_email', 'send_whatsapp', 'generate_report', 'browser_action'])
      .optional()
      .describe('Obrigatório para target=action.'),
    actionInput: z.record(z.unknown()).optional().describe('Payload da ação quando target=action.'),
  })
  .strict();

const updateInputSchema = createInputSchema.partial().extend({
  scheduleId: z.string().trim().min(1).describe('Id do agendamento a atualizar.'),
});

/** create_schedule — cria um agendamento por empresa a pedido do usuário. */
export function createCreateScheduleTool(port: SchedulePort): Tool {
  return defineTool({
    name: 'create_schedule',
    minRole: 'admin',
    description:
      'Cria um agendamento para a empresa. Use quando o usuário pedir para agendar uma ação ' +
      'recorrente ou pontual. Confirme o resumo (o quê, quando, repetição) com o usuário antes de criar. ' +
      'target=ai_agent exige aiConfig.instruction; target=action exige actionType/actionInput.',
    inputSchema: createInputSchema,
    async execute(ctx, input) {
      const schedule = await port.create(ctx, input);
      return {
        data: {
          scheduleId: schedule.id,
          name: schedule.name,
          enabled: schedule.enabled,
          message: `Agendamento "${schedule.name}" criado.`,
        },
        sources: [],
      };
    },
  });
}

/** list_schedules — lista os agendamentos da empresa. */
export function createListSchedulesTool(port: SchedulePort): Tool {
  return defineTool({
    name: 'list_schedules',
    minRole: 'member',
    description: 'Lista os agendamentos da empresa (nome, alvo, frequência, se está ativo).',
    inputSchema: z
      .object({ enabled: z.boolean().optional().describe('Filtra por ativos (true) ou inativos (false).') })
      .strict(),
    async execute(ctx, input) {
      const result = await port.list(ctx, input.enabled === undefined ? {} : { enabled: input.enabled });
      return {
        data: {
          total: result.total,
          schedules: result.items,
        },
        sources: [],
      };
    },
  });
}

/** update_schedule — atualiza um agendamento existente. */
export function createUpdateScheduleTool(port: SchedulePort): Tool {
  return defineTool({
    name: 'update_schedule',
    minRole: 'admin',
    description:
      'Atualiza um agendamento existente (nome, frequência, payload, effectMode, etc.). ' +
      'Informe scheduleId e apenas os campos a alterar.',
    inputSchema: updateInputSchema,
    async execute(ctx, input) {
      const { scheduleId, ...patch } = input;
      const schedule = await port.update(ctx, scheduleId, patch);
      return {
        data: { scheduleId: schedule.id, name: schedule.name, enabled: schedule.enabled, message: 'Agendamento atualizado.' },
        sources: [],
      };
    },
  });
}

/** disable_schedule — desativa (ou reativa) um agendamento. */
export function createDisableScheduleTool(port: SchedulePort): Tool {
  return defineTool({
    name: 'disable_schedule',
    minRole: 'admin',
    description:
      'Desativa (enabled=false) ou reativa (enabled=true) um agendamento. Desativar cancela ' +
      'as próximas execuções automáticas sem apagar o histórico.',
    inputSchema: z
      .object({
        scheduleId: z.string().trim().min(1),
        enabled: z.boolean().optional().describe('false para desativar (padrão), true para reativar.'),
      })
      .strict(),
    async execute(ctx, input) {
      const enabled = input.enabled ?? false;
      const schedule = await port.setEnabled(ctx, input.scheduleId, enabled);
      return {
        data: {
          scheduleId: schedule.id,
          enabled: schedule.enabled,
          message: enabled ? 'Agendamento reativado.' : 'Agendamento desativado.',
        },
        sources: [],
      };
    },
  });
}

/** trigger_schedule — dispara um agendamento agora (execução manual). */
export function createTriggerScheduleTool(port: SchedulePort): Tool {
  return defineTool({
    name: 'trigger_schedule',
    minRole: 'admin',
    description:
      'Dispara um agendamento imediatamente (execução manual), independentemente da recorrência. ' +
      'Cria uma nova ocorrência e a enfileira.',
    inputSchema: z.object({ scheduleId: z.string().trim().min(1) }).strict(),
    async execute(ctx, input) {
      const occurrence = await port.triggerNow(ctx, input.scheduleId);
      return {
        data: {
          occurrenceId: occurrence.id,
          status: occurrence.status,
          message: 'Agendamento disparado. A execução foi enfileirada.',
        },
        sources: [],
      };
    },
  });
}

/** All schedule tools, registered when a SchedulePort is provided. */
export function createScheduleTools(port: SchedulePort): Tool[] {
  return [
    createCreateScheduleTool(port),
    createListSchedulesTool(port),
    createUpdateScheduleTool(port),
    createDisableScheduleTool(port),
    createTriggerScheduleTool(port),
  ];
}
