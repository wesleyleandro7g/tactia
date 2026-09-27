import { logger } from '@tactia/shared';
import type { EmailMessage, EmailSendContext, EmailSender, EmailSendResult } from './types';
import type { SmtpProviderId } from './email-providers';
import {
  SmtpEmailSender,
  defaultSmtpTransportFactory,
  type SmtpTransportFactory,
} from './smtp-email-sender';

/** Shape of the stored config the resolver returns (mirrors domain's StoredEmailConfig). */
export type StoredEmailConfigLike = {
  provider: SmtpProviderId;
  fromName?: string;
  fromEmail: string;
  username: string;
  password: string;
  host?: string;
  port?: number;
  secure?: boolean;
};

/** Loads a tenant's stored SMTP config, or null when unconfigured. */
export type EmailConfigResolver = (tenantId: string) => Promise<StoredEmailConfigLike | null>;

export type TenantAwareEmailSenderOptions = {
  resolve: EmailConfigResolver;
  /** Used when the tenant has no email config (defaults to console logging). */
  fallback: EmailSender;
  /** Injectable transport factory (tests pass a fake to avoid sockets). */
  transportFactory?: SmtpTransportFactory;
};

/**
 * Resolves the per-tenant SMTP configuration at send time and delegates to a
 * `SmtpEmailSender`. When the tenant has not configured email (or no tenant is
 * present), it falls back to the provided sender so nothing breaks for tenants
 * without email — matching the previous console-only behaviour.
 */
export class TenantAwareEmailSender implements EmailSender {
  readonly driver = 'tenant-smtp';
  private readonly resolve: EmailConfigResolver;
  private readonly fallback: EmailSender;
  private readonly transportFactory: SmtpTransportFactory;

  constructor(options: TenantAwareEmailSenderOptions) {
    this.resolve = options.resolve;
    this.fallback = options.fallback;
    this.transportFactory = options.transportFactory ?? defaultSmtpTransportFactory;
  }

  private async senderForTenant(tenantId: string | undefined): Promise<EmailSender> {
    if (!tenantId) return this.fallback;
    const config = await this.resolve(tenantId);
    if (!config) {
      logger.info({
        operation: 'email_send_fallback',
        reason: 'no_tenant_config',
        tenant_id: tenantId,
      });
      return this.fallback;
    }
    return SmtpEmailSender.fromStoredConfig(config, this.transportFactory);
  }

  async send(message: EmailMessage, context?: EmailSendContext): Promise<EmailSendResult> {
    const sender = await this.senderForTenant(context?.tenantId);
    return sender.send(message, context);
  }
}
