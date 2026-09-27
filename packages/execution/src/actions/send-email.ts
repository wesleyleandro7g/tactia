import { z } from 'zod';
import { defineAction } from '../action-registry';
import type { ActionDefinition, EmailSender } from '../types';

export const sendEmailInputSchema = z.object({
  to: z.string().trim().email().describe('Destinatário.'),
  subject: z.string().trim().min(1).max(200).describe('Assunto.'),
  body: z.string().trim().min(1).max(10000).describe('Corpo da mensagem (texto).'),
  cc: z.array(z.string().trim().email()).max(10).optional().describe('Cópias.'),
});

export type SendEmailDeps = {
  emailSender: EmailSender;
};

/**
 * send_email — delegates to the configured `EmailSender`.
 * `Action.configuration.defaultCc` is merged into the recipients when present.
 */
export function sendEmailAction(deps: SendEmailDeps): ActionDefinition {
  return defineAction({
    type: 'send_email',
    name: 'Enviar e-mail',
    description: 'Envia um e-mail para um contato (cliente, lead ou vendedor).',
    defaultRequiresApproval: true,
    inputSchema: sendEmailInputSchema,
    async execute(ctx, input) {
      const configuredCc = Array.isArray(ctx.configuration['defaultCc'])
        ? (ctx.configuration['defaultCc'] as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const cc = [...new Set([...(input.cc ?? []), ...configuredCc])];

      const result = await deps.emailSender.send(
        {
          to: input.to,
          subject: input.subject,
          body: input.body,
          ...(cc.length > 0 ? { cc } : {}),
        },
        { tenantId: ctx.tenantId },
      );

      return {
        messageId: result.id,
        driver: result.driver,
        to: input.to,
        subject: input.subject,
        ...(cc.length > 0 ? { cc } : {}),
      };
    },
  });
}
