import { sendTestEmailSchema } from '@tactia/domain';
import { SmtpEmailSender, type SmtpTransportFactory } from '@tactia/execution';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { emailConfigService, scopedTenant } from './settings-services';

export async function getTenantEmailConfig(ctx: RequestContext, tenantId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  return emailConfigService.get(scoped);
}

export async function saveTenantEmailConfig(ctx: RequestContext, tenantId: string, raw: unknown) {
  const scoped = await scopedTenant(ctx, tenantId);
  return emailConfigService.save(scoped, raw);
}

export async function deleteTenantEmailConfig(ctx: RequestContext, tenantId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  return emailConfigService.delete(scoped);
}

/**
 * Verifies the SMTP connection and sends a test message to the given recipient
 * using the tenant's stored configuration. The transport factory is injectable
 * so tests never open a socket.
 */
export async function sendTenantTestEmail(
  ctx: RequestContext,
  tenantId: string,
  raw: unknown,
  transportFactory?: SmtpTransportFactory,
): Promise<{ sent: true; to: string; messageId: string }> {
  const scoped = await scopedTenant(ctx, tenantId);
  const { to } = sendTestEmailSchema.parse(raw);

  const config = await emailConfigService.getResolvedForSending(scoped);
  if (!config) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Configure o e-mail da empresa antes de enviar um teste.',
    );
  }

  const sender = transportFactory
    ? SmtpEmailSender.fromStoredConfig(config, transportFactory)
    : SmtpEmailSender.fromStoredConfig(config);

  // Fail fast with a clear auth/connection error before attempting to send.
  await sender.verify();

  const result = await sender.send({
    to,
    subject: 'Tactia — e-mail de teste',
    body:
      'Este é um e-mail de teste enviado pelo Tactia Ops para validar a ' +
      'configuração SMTP da sua empresa. Se você recebeu esta mensagem, o ' +
      'envio está funcionando.',
  });

  return { sent: true, to, messageId: result.id };
}
