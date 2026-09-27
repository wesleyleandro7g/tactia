import { describe, expect, it, vi } from 'vitest';
import { AgentSkillRepository } from '../repositories/agent-skill-repository';

describe('AgentSkillRepository tenant isolation', () => {
  it('scopes slug and resource lookups to the tenant', async () => {
    const db = {
      agentSkill: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const repo = new AgentSkillRepository(db as never);

    await repo.findBySlug('tenant-a', 'torge_skill');
    await repo.listForResource('tenant-b', 'browser_profile', 'profile-1');

    expect(db.agentSkill.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', slug: 'torge_skill', enabled: true },
    }));
    expect(db.agentSkill.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-b',
        bindings: { some: { tenantId: 'tenant-b', resourceType: 'browser_profile', resourceId: 'profile-1' } },
      }),
    }));
  });
});
