import type { AgentSkillRepository, PrismaClient } from '@tactia/database';
import { AppError, ErrorCode, logger, type RequestContext } from '@tactia/shared';
import { z } from 'zod';
import { assertOperator, assertTenantContext } from '../authz';
import { AuditAction, type AuditLogService } from './audit-log-service';

export const agentSkillSlugSchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,63}$/);
const markdownSchema = z.string().max(16_000);
export const createAgentSkillSchema = z.object({
  kind: z.enum(['global', 'secondary']),
  slug: agentSkillSlugSchema,
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(''),
  markdown: markdownSchema,
  enabled: z.boolean().optional().default(true),
}).strict();
export const updateAgentSkillSchema = createAgentSkillSchema.omit({ kind: true }).partial().strict();
export const createAgentSkillBindingSchema = z.object({
  resourceType: z.string().trim().min(2).max(60),
  resourceId: z.string().trim().min(1).max(200),
}).strict();

export type SkillResource = { id: string; label: string; detail?: string };
export type SkillResourceResolver = {
  type: string;
  label: string;
  list(tenantId: string): Promise<SkillResource[]>;
  exists(tenantId: string, resourceId: string): Promise<boolean>;
};

export class SkillResourceResolverRegistry {
  private readonly resolvers = new Map<string, SkillResourceResolver>();
  constructor(resolvers: SkillResourceResolver[]) {
    for (const resolver of resolvers) this.resolvers.set(resolver.type, resolver);
  }
  get(type: string) {
    const resolver = this.resolvers.get(type);
    if (!resolver) throw new AppError(ErrorCode.VALIDATION_ERROR, `Tipo de recurso de skill não suportado: ${type}`);
    return resolver;
  }
  async list(tenantId: string) {
    return Promise.all([...this.resolvers.values()].map(async (resolver) => ({
      type: resolver.type,
      label: resolver.label,
      items: await resolver.list(tenantId),
    })));
  }
}

export function createSkillResourceRegistry(db: PrismaClient) {
  return new SkillResourceResolverRegistry([
    {
      type: 'browser_profile',
      label: 'Perfil do Browser Agent',
      async list(tenantId) {
        return db.browserAutomationProfile.findMany({
          where: { tenantId }, select: { id: true, name: true, startUrl: true }, orderBy: { name: 'asc' },
        }).then((items) => items.map((item) => ({ id: item.id, label: item.name, detail: item.startUrl })));
      },
      async exists(tenantId, resourceId) {
        return (await db.browserAutomationProfile.count({ where: { tenantId, id: resourceId } })) === 1;
      },
    },
    {
      type: 'data_source',
      label: 'Fonte de dados / conexão',
      async list(tenantId) {
        return db.dataSource.findMany({
          where: { tenantId, status: { not: 'inactive' } }, select: { id: true, name: true, type: true }, orderBy: { name: 'asc' },
        }).then((items) => items.map((item) => ({ id: item.id, label: item.name, detail: item.type })));
      },
      async exists(tenantId, resourceId) {
        return (await db.dataSource.count({ where: { tenantId, id: resourceId, status: { not: 'inactive' } } })) === 1;
      },
    },
  ]);
}

export function normalizeAgentSkillMarkdown(value: string) {
  return value.replace(/\u0000/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').trim();
}

export function referencedSkillSlugs(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/\bskill:([a-z][a-z0-9_]{2,63})\b/g)].map((match) => match[1]!))];
}

export class AgentSkillService {
  constructor(
    private readonly skills: AgentSkillRepository,
    private readonly resources: SkillResourceResolverRegistry,
    private readonly auditLogs?: AuditLogService,
  ) {}

  private tenant(ctx: RequestContext): string {
    assertTenantContext(ctx);
    return ctx.tenantId!;
  }

  async list(ctx: RequestContext) {
    const tenantId = this.tenant(ctx);
    const items = await this.skills.list(tenantId);
    const known = new Map(items.map((item) => [item.slug, item]));
    return items.map((item) => ({ ...item, warnings: this.warnings(item.markdown, known) }));
  }

  context(ctx: RequestContext) {
    return this.contextForTenant(this.tenant(ctx));
  }

  async contextForTenant(tenantId: string) {
    const [global, catalog] = await Promise.all([
      this.skills.findGlobal(tenantId),
      this.skills.catalog(tenantId),
    ]);
    return { global, catalog };
  }

  async load(ctx: RequestContext, slug: string) {
    const tenantId = this.tenant(ctx);
    const skill = await this.skills.findBySlug(tenantId, agentSkillSlugSchema.parse(slug));
    if (!skill || skill.kind !== 'secondary') throw new AppError(ErrorCode.NOT_FOUND, 'Skill da empresa não encontrada ou desabilitada.');
    logger.info({ operation: 'agent_skill_loaded', tenant_id: tenantId, skill_slug: skill.slug, source: 'on_demand' });
    return skill;
  }

  forResource(ctx: RequestContext, resourceType: string, resourceId: string) {
    return this.forResourceForTenant(this.tenant(ctx), resourceType, resourceId);
  }

  async forResourceForTenant(tenantId: string, resourceType: string, resourceId: string) {
    const resolver = this.resources.get(resourceType);
    if (!(await resolver.exists(tenantId, resourceId))) return [];
    const items = await this.skills.listForResource(tenantId, resourceType, resourceId);
    logger.info({ operation: 'agent_skills_resolved', tenant_id: tenantId, resource_type: resourceType, resource_id: resourceId, skill_slugs: items.map((item) => item.slug), source: 'binding' });
    return items;
  }

  async listResources(ctx: RequestContext) {
    return this.resources.list(this.tenant(ctx));
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertOperator(ctx);
    const tenantId = this.tenant(ctx);
    const parsed = createAgentSkillSchema.parse(raw);
    const skill = await this.skills.create({ ...parsed, tenantId, markdown: normalizeAgentSkillMarkdown(parsed.markdown) });
    await this.auditLogs?.record(ctx, { action: AuditAction.AGENT_SKILL_CREATED, entityType: 'agent_skill', entityId: skill.id, metadata: { slug: skill.slug, kind: skill.kind } });
    return { ...skill, warnings: await this.warningsForTenant(tenantId, skill.markdown) };
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertOperator(ctx);
    const tenantId = this.tenant(ctx);
    const parsed = updateAgentSkillSchema.parse(raw);
    const current = await this.skills.findById(tenantId, id);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND, 'Skill não encontrada.');
    if (current.kind === 'global' && parsed.slug && parsed.slug !== current.slug) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'O slug da skill global é imutável.');
    }
    const skill = await this.skills.update(tenantId, id, { ...parsed, ...(parsed.markdown === undefined ? {} : { markdown: normalizeAgentSkillMarkdown(parsed.markdown) }) });
    if (!skill) throw new AppError(ErrorCode.NOT_FOUND, 'Skill não encontrada.');
    await this.auditLogs?.record(ctx, { action: AuditAction.AGENT_SKILL_UPDATED, entityType: 'agent_skill', entityId: skill.id, metadata: { slug: skill.slug, enabled: skill.enabled } });
    return { ...skill, warnings: await this.warningsForTenant(tenantId, skill.markdown) };
  }

  async remove(ctx: RequestContext, id: string) {
    assertOperator(ctx);
    const tenantId = this.tenant(ctx);
    const skill = await this.skills.findById(tenantId, id);
    if (!skill) throw new AppError(ErrorCode.NOT_FOUND, 'Skill não encontrada.');
    await this.skills.delete(tenantId, id);
    await this.auditLogs?.record(ctx, { action: AuditAction.AGENT_SKILL_DELETED, entityType: 'agent_skill', entityId: id, metadata: { slug: skill.slug } });
    return { id };
  }

  async bind(ctx: RequestContext, skillId: string, raw: unknown) {
    assertOperator(ctx);
    const tenantId = this.tenant(ctx);
    const skill = await this.skills.findById(tenantId, skillId);
    if (!skill || skill.kind !== 'secondary') throw new AppError(ErrorCode.NOT_FOUND, 'Skill secundária não encontrada.');
    const input = createAgentSkillBindingSchema.parse(raw);
    const resolver = this.resources.get(input.resourceType);
    if (!(await resolver.exists(tenantId, input.resourceId))) throw new AppError(ErrorCode.NOT_FOUND, 'Recurso vinculável não encontrado.');
    const binding = await this.skills.createBinding({ tenantId, skillId, ...input });
    await this.auditLogs?.record(ctx, { action: AuditAction.AGENT_SKILL_BOUND, entityType: 'agent_skill', entityId: skillId, metadata: input });
    return binding;
  }

  async unbind(ctx: RequestContext, skillId: string, bindingId: string) {
    assertOperator(ctx);
    const tenantId = this.tenant(ctx);
    const removed = await this.skills.deleteBinding(tenantId, skillId, bindingId);
    if (!removed.count) throw new AppError(ErrorCode.NOT_FOUND, 'Vínculo não encontrado.');
    await this.auditLogs?.record(ctx, { action: AuditAction.AGENT_SKILL_UNBOUND, entityType: 'agent_skill', entityId: skillId, metadata: { bindingId } });
    return { id: bindingId };
  }

  private warnings(markdown: string, known: Map<string, { enabled: boolean }>) {
    return referencedSkillSlugs(markdown).flatMap((slug) => {
      const target = known.get(slug);
      if (!target) return [{ code: 'MISSING_SKILL_REFERENCE', slug, message: `A referência skill:${slug} não existe.` }];
      if (!target.enabled) return [{ code: 'DISABLED_SKILL_REFERENCE', slug, message: `A referência skill:${slug} está desabilitada.` }];
      return [];
    });
  }

  private async warningsForTenant(tenantId: string, markdown: string) {
    const items = await this.skills.list(tenantId);
    return this.warnings(markdown, new Map(items.map((item) => [item.slug, item])));
  }
}
