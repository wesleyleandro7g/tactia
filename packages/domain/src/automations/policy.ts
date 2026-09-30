import { AppError, ErrorCode } from '@tactia/shared';
import type {
  AuthorizationPolicy,
  AutomationInputSchema,
  AutomationVersionBody,
  EmailEffectDecision,
} from './model';

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * A política publicada decide o efeito. `forceApproval` (effectMode=propose)
 * pode exigir aprovação extra, mas nunca autoriza um destinatário de fora.
 */
export function decideEmailEffect(
  policy: AuthorizationPolicy,
  recipient: string,
  forceApproval: boolean,
): EmailEffectDecision {
  const rule = policy.effects.send_email;
  if (!rule) return 'reject';
  const email = normalizedEmail(recipient);
  const preauthorized = rule.preauthorizedRecipients.map(normalizedEmail);
  const approval = rule.approvalRecipients.map(normalizedEmail);
  if (!preauthorized.includes(email) && !approval.includes(email)) return 'reject';
  if (forceApproval || !preauthorized.includes(email)) return 'approve';
  return 'allow';
}

export function assertConnectionAllowed(policy: AuthorizationPolicy, connectionId: string): void {
  if (!policy.connections.includes(connectionId)) {
    throw new AppError(
      ErrorCode.AUTHORIZATION_ERROR,
      'A conexão não está autorizada nesta automação.',
    );
  }
}

export function assertVersionBody(body: AutomationVersionBody): void {
  if (body.steps.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'A automação precisa de ao menos uma etapa.');
  }
  const keys = new Set<string>();
  for (const step of body.steps) {
    if (!step.key.trim() || keys.has(step.key)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Cada etapa precisa de uma chave única.');
    }
    keys.add(step.key);
    if (step.kind === 'send_email' && step.retryable) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'O envio de e-mail não pode ser repetido automaticamente.',
      );
    }
    if (step.kind === 'browser_workflow') {
      if (!step.workflowKey || !step.workflowVersion || !step.connectionId) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'A etapa de navegador exige workflow, versão e conexão.',
        );
      }
      assertConnectionAllowed(body.authorizationPolicy, step.connectionId);
    }
  }
  if (!body.inputSchema.fields.length) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'O schema de entrada precisa de campos.');
  }
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Mescla padrões liberados com o que o disparo enviou e valida o schema. */
export function resolveAutomationParams(
  schema: AutomationInputSchema,
  defaults: Record<string, unknown>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const known = new Set(schema.fields.map((field) => field.key));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Parâmetro não reconhecido: ${key}.`);
    }
  }
  const merged = { ...defaults, ...input };
  const resolved: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const field of schema.fields) {
    const value = merged[field.key];
    if (isBlank(value)) {
      if (field.required) missing.push(field.label || field.key);
      continue;
    }
    if (field.type === 'email' && (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `${field.label} precisa ser um e-mail.`);
    }
    if (field.type === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `${field.label} precisa ser uma data AAAA-MM-DD.`);
    }
    if (field.type === 'string' && typeof value !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `${field.label} precisa ser texto.`);
    }
    if (field.type === 'string[]') {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `${field.label} precisa ser uma lista.`);
      }
      if (field.enum) {
        const allowed = new Set(field.enum);
        for (const item of value) {
          if (!allowed.has(item)) {
            throw new AppError(ErrorCode.VALIDATION_ERROR, `${field.label} contém um valor fora da lista.`);
          }
        }
      }
    }
    if (field.enum && field.type !== 'string[]' && typeof value === 'string' && !field.enum.includes(value)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `${field.label} contém um valor fora da lista.`);
    }
    resolved[field.key] = value;
  }
  if (missing.length > 0) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Parâmetros obrigatórios ausentes: ${missing.join(', ')}.`,
    );
  }
  return resolved;
}

/** Só chaves liberadas na versão publicada podem ser alteradas pelo cliente. */
export function pickReleasedDefaults(
  schema: AutomationInputSchema,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const released = new Set(schema.fields.filter((field) => field.released).map((field) => field.key));
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!released.has(key)) {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, `O parâmetro ${key} não está liberado para o cliente.`);
    }
    next[key] = value;
  }
  return next;
}
