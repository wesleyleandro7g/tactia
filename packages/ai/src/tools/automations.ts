import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool, ToolContext } from '../types';

export type AutomationPort = {
  list(ctx: ToolContext): Promise<{
    items: Array<{ id: string; name: string; purpose: string; status: string }>;
  }>;
  get(
    ctx: ToolContext,
    id: string,
  ): Promise<{
    id: string;
    name: string;
    purpose: string;
    status: string;
    fields: Array<{ key: string; label: string; type: string; required: boolean; enum?: string[] }>;
  }>;
  run(
    ctx: ToolContext,
    input: { automationId: string; params: Record<string, unknown>; idempotencyKey?: string },
  ): Promise<{ id: string; status: string; url: string; summary: string | null }>;
  getRun(
    ctx: ToolContext,
    input: { automationId: string; runId: string },
  ): Promise<{ id: string; status: string; url: string; summary: string | null; error: string | null }>;
};

const runSchema = z
  .object({
    automationId: z.string().uuid().describe('Id da automação publicada.'),
    params: z.record(z.unknown()).describe('Parâmetros exigidos por get_automation. Não invente valores.'),
    idempotencyKey: z.string().trim().min(8).max(200).optional().describe('Chave para não disparar duas vezes o mesmo pedido.'),
  })
  .strict();

export function createAutomationTools(port: AutomationPort): Tool[] {
  return [
    defineTool({
      name: 'list_automations',
      minRole: 'viewer',
      description: 'Lista as automações publicadas da empresa, com finalidade e situação.',
      inputSchema: z.object({}).strict(),
      async execute(ctx) {
        const page = await port.list(ctx);
        return { data: page, sources: [] };
      },
    }),
    defineTool({
      name: 'get_automation',
      minRole: 'viewer',
      description:
        'Mostra os parâmetros de uma automação. Peça ao usuário qualquer campo obrigatório que ainda não tenha sido informado.',
      inputSchema: z.object({ automationId: z.string().uuid() }).strict(),
      async execute(ctx, input) {
        const detail = await port.get(ctx, input.automationId);
        return { data: detail, sources: [] };
      },
    }),
    defineTool({
      name: 'run_automation',
      minRole: 'member',
      description:
        'Inicia uma automação e devolve o link de acompanhamento. Não espere a conclusão nesta conversa. ' +
        'Se faltar parâmetro obrigatório, pergunte ao usuário em vez de chutar.',
      inputSchema: runSchema,
      async execute(ctx, input) {
        const run = await port.run(ctx, input);
        return {
          data: {
            ...run,
            message: `Execução iniciada. Acompanhe em ${run.url}.`,
          },
          sources: [],
        };
      },
    }),
    defineTool({
      name: 'get_automation_run',
      minRole: 'viewer',
      description: 'Consulta o estado de uma execução de automação já iniciada.',
      inputSchema: z.object({ automationId: z.string().uuid(), runId: z.string().uuid() }).strict(),
      async execute(ctx, input) {
        const run = await port.getRun(ctx, input);
        return { data: run, sources: [] };
      },
    }),
  ];
}
