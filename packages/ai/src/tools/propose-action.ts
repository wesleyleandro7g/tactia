import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { ActionProposal, Tool, ToolContext } from '../types';

/**
 * Action types the assistant may propose in V0.1. Mirrors the executors
 * registered in `@tactia/execution`; the engine validates again on its side.
 */
export const PROPOSABLE_ACTION_TYPES = ['create_task', 'send_email'] as const;

/**
 * Port implemented by the Execution Engine (Etapa 7) and injected at the app
 * layer. Keeps `@tactia/ai` free of any dependency on the execution package.
 */
export type ActionProposalPort = {
  propose(
    ctx: ToolContext,
    input: { actionType: string; input: Record<string, unknown>; reason?: string | null },
  ): Promise<ActionProposal>;
};

const inputSchema = z.object({
  actionType: z
    .enum(PROPOSABLE_ACTION_TYPES)
    .describe('Ação a propor: create_task (criar tarefa) ou send_email (enviar e-mail).'),
  input: z
    .record(z.unknown())
    .describe(
      'Payload da ação. create_task: { title, description?, dueDate?, customerId?, leadId?, sellerId? }. ' +
        'send_email: { to, subject, body, cc? }.',
    ),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe('Justificativa da proposta, mostrada a quem aprova.'),
});

/**
 * propose_action — the only way the assistant touches the outside world, and it
 * does so by *proposing*: the execution is parked in `awaiting_approval` until
 * a human approves it (spec §44).
 */
export function createProposeActionTool(proposer: ActionProposalPort): Tool {
  return defineTool({
    name: 'propose_action',
    minRole: 'member',
    description:
      'Propõe uma ação estruturada para aprovação humana: criar tarefa (create_task) ou ' +
      'enviar e-mail (send_email). A ação NÃO é executada por você — ela fica pendente de ' +
      'aprovação. Use quando o usuário pedir uma providência concreta.',
    inputSchema,
    async execute(ctx, input) {
      const proposal = await proposer.propose(ctx, {
        actionType: input.actionType,
        input: input.input,
        reason: input.reason ?? null,
      });

      return {
        data: {
          proposalId: proposal.id,
          actionType: proposal.actionType,
          status: proposal.status,
          requiresApproval: proposal.requiresApproval,
          message:
            'Ação registrada como proposta e pendente de aprovação humana. Informe ao usuário ' +
            'que ela precisa ser aprovada e não afirme que já foi executada.',
        },
        sources: [],
        proposal: { ...proposal, input: input.input },
      };
    },
  });
}
