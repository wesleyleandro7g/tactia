import { z } from 'zod';
import { BrowserAutomationRepository, CredentialRepository, TenantRepository, prisma } from '@tactia/database';
import { assertOperator } from '@tactia/domain';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';

const profiles = new BrowserAutomationRepository(prisma);
const credentials = new CredentialRepository(prisma);
const tenants = new TenantRepository(prisma);

const allowedDestinationSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+(?::[1-9]\d{0,4})?$/)
  .refine((destination) => {
    const port = destination.match(/:(\d+)$/)?.[1];
    return !port || Number(port) <= 65535;
  }, 'Invalid destination port');

function normalizeSkillMarkdown(value: string): string {
  return value.replace(/\u0000/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').trim();
}

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  startUrl: z.string().url(),
  allowedDomains: z.array(allowedDestinationSchema).min(1).max(20),
  credentialId: z.string().uuid().nullable().optional(),
});

const globalSkillSchema = z.object({
  skillMarkdown: z.string().max(16000),
});

async function requireTenant(ctx: RequestContext, tenantId: string) {
  assertOperator(ctx);
  if (!(await tenants.findByIdForOperator(tenantId))) throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');
}

function checkDomains(input: z.infer<typeof profileSchema>) {
  const url = new URL(input.startUrl);
  if (url.protocol !== 'https:' && !(process.env.BROWSER_TEST_LOCAL === 'true' && url.protocol === 'http:')) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Browser profile requires HTTPS');
  }
  const startDestination =
    url.port && url.port !== '443'
      ? `${url.hostname.toLowerCase()}:${url.port}`
      : url.hostname.toLowerCase();
  if (!input.allowedDomains.includes(startDestination)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Start URL host must be in allowed domains');
  }
  if (input.allowedDomains.some((destination) => {
    const host = destination.replace(/:\d+$/, '');
    return host === 'localhost' || host.endsWith('.localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  })) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Private hosts are not allowed');
  }
}

export async function listBrowserProfiles(ctx: RequestContext, tenantId: string) {
  await requireTenant(ctx, tenantId);
  const [items, globalSkillMarkdown] = await Promise.all([
    profiles.listProfiles(tenantId, true),
    profiles.tenantSkillMarkdown(tenantId),
  ]);
  return { items, globalSkillMarkdown };
}

export async function updateGlobalBrowserSkills(
  ctx: RequestContext,
  tenantId: string,
  raw: unknown,
) {
  await requireTenant(ctx, tenantId);
  const input = globalSkillSchema.parse(raw);
  return profiles.updateTenantSkillMarkdown(tenantId, normalizeSkillMarkdown(input.skillMarkdown));
}

export async function createBrowserProfile(ctx: RequestContext, tenantId: string, raw: unknown) {
  await requireTenant(ctx, tenantId);
  const parsed = profileSchema.parse(raw);
  const input = parsed;
  checkDomains(input);
  if (input.credentialId && !(await credentials.findById({ tenantId, id: input.credentialId }))) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Credential not found');
  }
  const profile = await profiles.createProfile({ tenantId, ...input });
  return { id: profile.id, name: profile.name, startUrl: profile.startUrl, allowedDomains: profile.allowedDomains, skillMarkdown: profile.skillMarkdown, credentialId: profile.credentialId };
}

export async function updateBrowserProfile(ctx: RequestContext, tenantId: string, profileId: string, raw: unknown) {
  await requireTenant(ctx, tenantId);
  const existing = await profiles.findProfile(tenantId, profileId);
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'Browser profile not found');
  const parsed = profileSchema.partial().parse(raw);
  const input = parsed;
  const next = {
    name: input.name ?? existing.name,
    startUrl: input.startUrl ?? existing.startUrl,
    allowedDomains: input.allowedDomains ?? existing.allowedDomains as string[],
    credentialId: input.credentialId === undefined ? existing.credentialId : input.credentialId,
  };
  checkDomains(next);
  if (next.credentialId && !(await credentials.findById({ tenantId, id: next.credentialId }))) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Credential not found');
  }
  const profile = await profiles.updateProfile(tenantId, profileId, next);
  return profile && { id: profile.id, name: profile.name, startUrl: profile.startUrl, allowedDomains: profile.allowedDomains, skillMarkdown: profile.skillMarkdown, credentialId: profile.credentialId };
}
