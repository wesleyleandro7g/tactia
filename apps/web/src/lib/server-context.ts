import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { MembershipRole, RequestContext } from '@tactia/shared';
import { resolveRequestContext } from './api';
import { tenantService } from './services';

/**
 * Contexto de requisição para Server Components.
 *
 * Reaproveita exatamente o mesmo `resolveRequestContext` das rotas `/api/v1/*`
 * (sessão → usuário de domínio → tenant ativo → papel), montando um `Request`
 * sintético com os headers da requisição atual — assim não existe uma segunda
 * implementação de autenticação para manter.
 */
export async function getServerContext(): Promise<RequestContext> {
  const incoming = await headers();
  return resolveRequestContext(new Request('http://localhost/rsc', { headers: incoming }));
}

export type TenantContext = RequestContext & {
  userId: string;
  tenantId: string;
  role: MembershipRole;
};

/** Exige sessão. Sem ela, manda para o login preservando o destino. */
export async function requireUser(returnTo?: string): Promise<RequestContext & { userId: string }> {
  const ctx = await getServerContext();
  if (!ctx.userId) {
    redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login');
  }
  return ctx as RequestContext & { userId: string };
}

/**
 * Exige sessão + tenant ativo. Usuário autenticado sem empresa vai para o
 * onboarding, que orienta a aguardar a liberação pela equipe Tactia.
 */
export async function requireTenant(returnTo?: string): Promise<TenantContext> {
  const ctx = await requireUser(returnTo);
  if (!ctx.tenantId || !ctx.role) redirect('/onboarding');
  return ctx as TenantContext;
}

/** Empresas do usuário + qual está ativa (usado pelo seletor no shell). */
export async function listUserTenants(ctx: RequestContext) {
  if (!ctx.userId) return [];
  return tenantService.listForUser(ctx);
}
