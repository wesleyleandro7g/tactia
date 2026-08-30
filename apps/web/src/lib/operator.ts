import type { RequestContext } from '@tactia/shared';
import { AppError, ErrorCode } from '@tactia/shared';
import { prisma } from '@tactia/database';

/**
 * Painel interno do operador (spec §54).
 *
 * Não existe papel de "operador" no modelo de domínio: o acesso é liberado por
 * allowlist de e-mail em `TACTIA_OPERATOR_EMAILS`. É um acesso cross-tenant,
 * então tudo aqui é somente leitura ou passa por rota auditada.
 */
/** Só o que este módulo lê do ambiente — permite injetar env nos testes. */
export type OperatorEnv = Record<string, string | undefined>;

export function operatorEmails(env: OperatorEnv = process.env as OperatorEnv): string[] {
  return (env['TACTIA_OPERATOR_EMAILS'] ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function isOperatorEmail(
  email: string | null | undefined,
  env: OperatorEnv = process.env as OperatorEnv,
): boolean {
  if (!email) return false;
  const allowlist = operatorEmails(env);
  if (allowlist.length === 0) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

/** Resolve o e-mail do usuário da sessão para checar a allowlist. */
export async function isOperator(ctx: RequestContext): Promise<boolean> {
  if (!ctx.userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { email: true },
  });
  return isOperatorEmail(user?.email);
}

/**
 * Nunca revela a existência do painel: quem não está na allowlist recebe
 * NOT_FOUND (404), não 403.
 */
export async function assertOperator(ctx: RequestContext): Promise<void> {
  if (!(await isOperator(ctx))) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Not found');
  }
}
