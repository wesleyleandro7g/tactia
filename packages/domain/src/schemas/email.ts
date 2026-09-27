import { z } from 'zod';

/**
 * SMTP provider ids accepted by the email configuration. Kept in sync with
 * `SMTP_PROVIDER_PRESETS` in `@tactia/execution` (domain must not import
 * execution — that would invert the package dependency).
 */
export const SMTP_PROVIDER_ENUM = [
  'gmail',
  'outlook',
  'office365',
  'yahoo',
  'zoho',
  'custom',
] as const;

export type SmtpProviderId = (typeof SMTP_PROVIDER_ENUM)[number];

/**
 * Company email (SMTP) configuration. For `custom` the host/port/secure are
 * required; for the named providers they are resolved from the preset and must
 * be omitted here.
 */
export const emailConfigSchema = z
  .object({
    provider: z.enum(SMTP_PROVIDER_ENUM),
    fromName: z.string().trim().min(1).max(120).optional(),
    fromEmail: z.string().trim().email().max(200),
    username: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(500),
    host: z.string().trim().min(1).max(255).optional(),
    port: z.coerce.number().int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.provider === 'custom') {
      if (!value.host) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['host'],
          message: 'Host é obrigatório para SMTP personalizado.',
        });
      }
      if (value.port === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['port'],
          message: 'Porta é obrigatória para SMTP personalizado.',
        });
      }
      if (value.secure === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['secure'],
          message: 'Segurança (TLS) é obrigatória para SMTP personalizado.',
        });
      }
    }
  });

export type EmailConfigInput = z.infer<typeof emailConfigSchema>;

/** Recipient for the "send test email" action. */
export const sendTestEmailSchema = z.object({
  to: z.string().trim().email().max(200),
});

export type SendTestEmailInput = z.infer<typeof sendTestEmailSchema>;
