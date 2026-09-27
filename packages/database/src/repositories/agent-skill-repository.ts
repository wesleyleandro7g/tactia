import { createId } from '@tactia/shared';
import type { AgentSkillKind, PrismaClient } from '../client';

export type CreateAgentSkillInput = {
  tenantId: string;
  kind: AgentSkillKind;
  slug: string;
  title: string;
  description: string;
  markdown: string;
  enabled?: boolean;
};

export class AgentSkillRepository {
  constructor(private readonly db: PrismaClient) {}

  list(tenantId: string) {
    return this.db.agentSkill.findMany({
      where: { tenantId },
      include: { bindings: { orderBy: [{ resourceType: 'asc' }, { resourceId: 'asc' }] } },
      orderBy: [{ kind: 'asc' }, { slug: 'asc' }],
    });
  }

  catalog(tenantId: string) {
    return this.db.agentSkill.findMany({
      where: { tenantId, kind: 'secondary', enabled: true },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        bindings: { select: { resourceType: true, resourceId: true } },
      },
      orderBy: { slug: 'asc' },
      take: 60,
    });
  }

  findGlobal(tenantId: string, enabledOnly = true) {
    return this.db.agentSkill.findFirst({
      where: { tenantId, kind: 'global', ...(enabledOnly ? { enabled: true } : {}) },
    });
  }

  findById(tenantId: string, id: string) {
    return this.db.agentSkill.findFirst({
      where: { tenantId, id },
      include: { bindings: true },
    });
  }

  findBySlug(tenantId: string, slug: string, enabledOnly = true) {
    return this.db.agentSkill.findFirst({
      where: { tenantId, slug, ...(enabledOnly ? { enabled: true } : {}) },
      include: { bindings: true },
    });
  }

  create(input: CreateAgentSkillInput) {
    return this.db.agentSkill.create({
      data: { id: createId(), ...input, enabled: input.enabled ?? true },
      include: { bindings: true },
    });
  }

  async update(tenantId: string, id: string, data: Partial<Omit<CreateAgentSkillInput, 'tenantId' | 'kind'>>) {
    const updated = await this.db.agentSkill.updateMany({ where: { tenantId, id }, data });
    return updated.count ? this.findById(tenantId, id) : null;
  }

  delete(tenantId: string, id: string) {
    return this.db.agentSkill.deleteMany({ where: { tenantId, id } });
  }

  createBinding(input: { tenantId: string; skillId: string; resourceType: string; resourceId: string }) {
    return this.db.agentSkillBinding.create({ data: { id: createId(), ...input } });
  }

  deleteBinding(tenantId: string, skillId: string, bindingId: string) {
    return this.db.agentSkillBinding.deleteMany({ where: { tenantId, skillId, id: bindingId } });
  }

  listForResource(tenantId: string, resourceType: string, resourceId: string) {
    return this.db.agentSkill.findMany({
      where: {
        tenantId,
        kind: 'secondary',
        enabled: true,
        bindings: { some: { tenantId, resourceType, resourceId } },
      },
      orderBy: { slug: 'asc' },
    });
  }
}
