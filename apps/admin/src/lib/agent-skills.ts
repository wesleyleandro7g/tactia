import { prisma } from '@tactia/database';
import type { RequestContext } from '@tactia/shared';
import { chatServices, chatTenantContext } from './chat';

async function scoped(ctx: RequestContext, tenantId: string) {
  return chatTenantContext(ctx, tenantId);
}

export async function listAgentSkills(ctx: RequestContext, tenantId: string) {
  const tenantCtx = await scoped(ctx, tenantId);
  const [items, resources, legacyProfiles] = await Promise.all([
    chatServices.agentSkillService.list(tenantCtx),
    chatServices.agentSkillService.listResources(tenantCtx),
    prisma.browserAutomationProfile.findMany({
      where: { tenantId, skillMarkdown: { not: '' } },
      select: { id: true, name: true, skillMarkdown: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const boundProfiles = new Set(
    items.flatMap((skill) => skill.bindings)
      .filter((binding) => binding.resourceType === 'browser_profile')
      .map((binding) => binding.resourceId),
  );
  return {
    items,
    resources,
    legacyProfiles: legacyProfiles.map((profile) => ({
      ...profile,
      migrated: boundProfiles.has(profile.id),
    })),
  };
}

export async function createAgentSkill(ctx: RequestContext, tenantId: string, body: unknown) {
  return chatServices.agentSkillService.create(await scoped(ctx, tenantId), body);
}
export async function updateAgentSkill(ctx: RequestContext, tenantId: string, skillId: string, body: unknown) {
  return chatServices.agentSkillService.update(await scoped(ctx, tenantId), skillId, body);
}
export async function deleteAgentSkill(ctx: RequestContext, tenantId: string, skillId: string) {
  return chatServices.agentSkillService.remove(await scoped(ctx, tenantId), skillId);
}
export async function bindAgentSkill(ctx: RequestContext, tenantId: string, skillId: string, body: unknown) {
  return chatServices.agentSkillService.bind(await scoped(ctx, tenantId), skillId, body);
}
export async function unbindAgentSkill(ctx: RequestContext, tenantId: string, skillId: string, bindingId: string) {
  return chatServices.agentSkillService.unbind(await scoped(ctx, tenantId), skillId, bindingId);
}
