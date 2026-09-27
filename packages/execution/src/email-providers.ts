/**
 * SMTP provider presets.
 *
 * Each preset carries the connection defaults for a well-known mailbox
 * provider so the operator only has to supply credentials. `custom` requires
 * the host/port/secure to be provided explicitly (see `emailConfigSchema`).
 *
 * Ports follow the SMTP submission conventions:
 *  - 465 → implicit TLS (`secure: true`)
 *  - 587 → STARTTLS (`secure: false`, upgraded after EHLO)
 */

export type SmtpProviderId =
  | 'gmail'
  | 'outlook'
  | 'office365'
  | 'yahoo'
  | 'zoho'
  | 'custom';

export type SmtpProviderPreset = {
  readonly id: SmtpProviderId;
  readonly label: string;
  /** Host is undefined for `custom` — the operator must supply it. */
  readonly host?: string;
  readonly port?: number;
  /** true → implicit TLS (465); false → STARTTLS (587). */
  readonly secure?: boolean;
  /** Short hint shown in the UI (e.g. app-password requirement). */
  readonly hint?: string;
};

export const SMTP_PROVIDER_PRESETS: Record<SmtpProviderId, SmtpProviderPreset> = {
  gmail: {
    id: 'gmail',
    label: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    hint: 'Requer uma senha de app (verificação em duas etapas ativada).',
  },
  outlook: {
    id: 'outlook',
    label: 'Outlook.com / Hotmail',
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    hint: 'Requer uma senha de app quando a conta usa MFA.',
  },
  office365: {
    id: 'office365',
    label: 'Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    hint: 'Requer uma senha de app; o envio SMTP deve estar habilitado no tenant.',
  },
  yahoo: {
    id: 'yahoo',
    label: 'Yahoo Mail',
    host: 'smtp.mail.yahoo.com',
    port: 465,
    secure: true,
    hint: 'Requer uma senha de app gerada nas configurações de segurança.',
  },
  zoho: {
    id: 'zoho',
    label: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    hint: 'Use uma senha de app quando a MFA estiver ativa.',
  },
  custom: {
    id: 'custom',
    label: 'SMTP personalizado',
    hint: 'Informe host, porta e segurança do seu servidor SMTP.',
  },
};

export const SMTP_PROVIDER_IDS = Object.keys(SMTP_PROVIDER_PRESETS) as SmtpProviderId[];

export function getSmtpProviderPreset(id: SmtpProviderId): SmtpProviderPreset {
  return SMTP_PROVIDER_PRESETS[id];
}

/** Resolved connection parameters ready to hand to a transport. */
export type ResolvedSmtpConnection = {
  host: string;
  port: number;
  secure: boolean;
};

/**
 * Resolves the effective host/port/secure from a provider id and optional
 * overrides. For `custom`, host/port/secure must be present in `overrides`.
 */
export function resolveSmtpConnection(
  provider: SmtpProviderId,
  overrides: Partial<ResolvedSmtpConnection> = {},
): ResolvedSmtpConnection {
  const preset = getSmtpProviderPreset(provider);
  const host = overrides.host ?? preset.host;
  const port = overrides.port ?? preset.port;
  const secure = overrides.secure ?? preset.secure;

  if (!host || port === undefined || secure === undefined) {
    throw new Error(
      `Configuração SMTP incompleta para o provedor '${provider}': host, porta e segurança são obrigatórios.`,
    );
  }
  return { host, port, secure };
}
