import { createId, logger } from '@tactia/shared';
import type { EmailMessage, EmailSender, EmailSendResult } from './types';

/**
 * Dev/pilot driver: writes the message to the structured log instead of
 * sending it. The goal of Etapa 7 is the execution rail, not the provider —
 * swapping in SES/Resend means implementing `EmailSender` and rewiring.
 */
export class ConsoleEmailSender implements EmailSender {
  readonly driver = 'console';

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const id = createId();
    logger.info({
      operation: 'email_send',
      driver: this.driver,
      message_id: id,
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      body_length: message.body.length,
    });
    return { id, driver: this.driver };
  }
}

/** Test double: keeps every message in memory and can simulate failures. */
export class MemoryEmailSender implements EmailSender {
  readonly driver = 'memory';
  readonly sent: EmailMessage[] = [];

  constructor(private readonly failWith?: string) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.failWith) throw new Error(this.failWith);
    this.sent.push(message);
    return { id: createId(), driver: this.driver };
  }
}
