import { z } from 'zod';
import { defineAction } from '../action-registry';
import { isUncertainEmailError, uncertainEmailMessage } from '../automations/email-uncertainty';
import type { ActionDefinition, EmailAttachment, EmailSender } from '../types';

export const sendEmailInputSchema = z.object({
  to: z.string().trim().email().describe('Destinatário.'),
  subject: z.string().trim().min(1).max(200).describe('Assunto.'),
  body: z.string().trim().min(1).max(10000).describe('Corpo da mensagem (texto).'),
  cc: z.array(z.string().trim().email()).max(10).optional().describe('Cópias.'),
  artifactIds: z.array(z.string().uuid()).max(10).optional().describe('Anexos já armazenados no tenant.'),
});

export type EmailArtifactResolver = {
  load(tenantId: string, artifactIds: string[]): Promise<EmailAttachment[]>;
};

export type SendEmailDeps = {
  emailSender: EmailSender;
  artifactResolver?: EmailArtifactResolver;
};

/**
 * send_email — delegates to the configured `EmailSender`.
 * `Action.configuration.defaultCc` is merged into the recipients when present.
 * Anexos são resolvidos no tenant antes de chegar ao transporte.
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
      const artifactIds = input.artifactIds ?? [];
      let attachments: EmailAttachment[] | undefined;
      if (artifactIds.length > 0) {
        if (!deps.artifactResolver) {
          throw new Error('Resolvedor de anexos não configurado.');
        }
        attachments = await deps.artifactResolver.load(ctx.tenantId, artifactIds);
      }

      try {
        const result = await deps.emailSender.send(
          {
            to: input.to,
            subject: input.subject,
            body: input.body,
            ...(cc.length > 0 ? { cc } : {}),
            ...(attachments ? { attachments } : {}),
          },
          { tenantId: ctx.tenantId },
        );
        return {
          messageId: result.id,
          driver: result.driver,
          to: input.to,
          subject: input.subject,
          ...(cc.length > 0 ? { cc } : {}),
          ...(artifactIds.length > 0 ? { artifactIds } : {}),
        };
      } catch (error) {
        if (isUncertainEmailError(error)) {
          throw new Error(`EMAIL_DELIVERY_UNCERTAIN: ${uncertainEmailMessage(error)}`);
        }
        throw error;
      }
    },
  });
}
