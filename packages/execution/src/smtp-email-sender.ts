import nodemailer, { type Transporter } from 'nodemailer';
import { createId, logger } from '@tactia/shared';
import type { EmailMessage, EmailSender, EmailSendResult } from './types';
import { resolveSmtpConnection, type SmtpProviderId } from './email-providers';

/**
 * Fully-resolved SMTP configuration handed to the transport. `host/port/secure`
 * are already resolved from the provider preset (see `resolveSmtpConnection`).
 */
export type ResolvedSmtpConfig = {
  provider: SmtpProviderId;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName?: string;
};

/** Minimal transport surface used by the sender (subset of nodemailer). */
export interface SmtpTransport {
  sendMail(options: {
    from: string;
    to: string;
    cc?: string;
    subject: string;
    text: string;
  }): Promise<{ messageId?: string }>;
  verify(): Promise<true>;
}

export type SmtpTransportFactory = (config: ResolvedSmtpConfig) => SmtpTransport;

/** Default factory: builds a real nodemailer transport. */
export const defaultSmtpTransportFactory: SmtpTransportFactory = (config) => {
  const transporter: Transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
  });
  return {
    async sendMail(options) {
      return transporter.sendMail(options);
    },
    async verify() {
      await transporter.verify();
      return true;
    },
  };
};

/** Builds the RFC 5322 `From` header from name + email. */
export function formatFromHeader(config: Pick<ResolvedSmtpConfig, 'fromEmail' | 'fromName'>): string {
  return config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail;
}

/**
 * Real e-mail transport over SMTP (nodemailer). Works with the provider presets
 * (Gmail, Outlook, Microsoft 365, Yahoo, Zoho) or a custom SMTP host.
 *
 * The transport factory is injectable so tests never open a socket.
 */
export class SmtpEmailSender implements EmailSender {
  readonly driver = 'smtp';
  private readonly factory: SmtpTransportFactory;

  constructor(
    private readonly config: ResolvedSmtpConfig,
    factory: SmtpTransportFactory = defaultSmtpTransportFactory,
  ) {
    this.factory = factory;
  }

  /** Builds a resolved config from a stored provider + credentials. */
  static fromStoredConfig(
    stored: {
      provider: SmtpProviderId;
      username: string;
      password: string;
      fromEmail: string;
      fromName?: string;
      host?: string;
      port?: number;
      secure?: boolean;
    },
    factory: SmtpTransportFactory = defaultSmtpTransportFactory,
  ): SmtpEmailSender {
    const connection = resolveSmtpConnection(stored.provider, {
      ...(stored.host !== undefined ? { host: stored.host } : {}),
      ...(stored.port !== undefined ? { port: stored.port } : {}),
      ...(stored.secure !== undefined ? { secure: stored.secure } : {}),
    });
    return new SmtpEmailSender(
      {
        provider: stored.provider,
        host: connection.host,
        port: connection.port,
        secure: connection.secure,
        username: stored.username,
        password: stored.password,
        fromEmail: stored.fromEmail,
        ...(stored.fromName ? { fromName: stored.fromName } : {}),
      },
      factory,
    );
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const transport = this.factory(this.config);
    const info = await transport.sendMail({
      from: formatFromHeader(this.config),
      to: message.to,
      ...(message.cc && message.cc.length > 0 ? { cc: message.cc.join(', ') } : {}),
      subject: message.subject,
      text: message.body,
    });
    const id = info.messageId ?? createId();
    logger.info({
      operation: 'email_send',
      driver: this.driver,
      provider: this.config.provider,
      message_id: id,
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      body_length: message.body.length,
    });
    return { id, driver: this.driver };
  }

  /** Opens a connection and authenticates without sending — used by the UI test. */
  async verify(): Promise<true> {
    const transport = this.factory(this.config);
    return transport.verify();
  }
}
