import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool, ToolContext } from '../types';

/**
 * Port for the direct e-mail send. Implemented by the Execution Engine's
 * `sendEmailFromAi` at the app layer, keeping `@tactia/ai` free of any
 * dependency on the execution package.
 */
export type DirectEmailPort = {
  sendEmailDirect(
    ctx: ToolContext,
    input: {
      input: Record<string, unknown>;
      reason?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<{
    id: string;
    actionType: string;
    status: string;
    output?: Record<string, unknown> | null;
    error?: string | null;
  }>;
};

const inputSchema = z.object({
  to: z.string().trim().email().describe('Destinatário.'),
  subject: z.string().trim().min(1).max(200).describe('Assunto.'),
  body: z.string().trim().min(1).max(10000).describe('Corpo da mensagem (texto).'),
  cc: z.array(z.string().trim().email()).max(10).optional().describe('Cópias.'),
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(200)
    .optional()
    .describe('Chave estável para impedir envios duplicados em novas tentativas.'),
});

/**
 * send_email — sends an e-mail immediately on the user's request, using the
 * company's configured SMTP. Unlike `propose_action`, this does NOT wait for
 * human approval: the message is sent as soon as the tool runs. Use it only
 * when the user explicitly asks to send an e-mail.
 */
export function createSendEmailTool(port: DirectEmailPort): Tool {
  return defineTool({
    name: 'send_email',
    minRole: 'member',
    description:
      'Envia um e-mail imediatamente para um contato (cliente, lead ou vendedor), usando o SMTP ' +
      'da empresa. O e-mail É ENVIADO na hora, sem aprovação humana. Use apenas quando o usuário ' +
      'pedir explicitamente para enviar um e-mail. Confirme o envio somente após o status voltar ' +
      "como 'completed'.",
    inputSchema,
    async execute(ctx, input) {
      const { idempotencyKey, ...message } = input;
      const result = await port.sendEmailDirect(ctx, {
        input: message,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });

      const sent = result.status === 'completed';
      const output = (result.output ?? {}) as Record<string, unknown>;

      return {
        data: {
          executionId: result.id,
          status: result.status,
          sent,
          ...(sent && typeof output['messageId'] === 'string'
            ? { messageId: output['messageId'] }
            : {}),
          to: message.to,
          subject: message.subject,
          message: sent
            ? 'E-mail enviado com sucesso. Você pode confirmar o envio ao usuário.'
            : result.error
              ? `Falha ao enviar o e-mail: ${result.error}. Não afirme que o envio foi concluído.`
              : `Envio em processamento (status: ${result.status}). Não afirme que já foi concluído.`,
        },
        sources: [],
      };
    },
  });
}
