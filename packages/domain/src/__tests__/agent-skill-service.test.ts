import { describe, expect, it, vi } from 'vitest';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import {
  AgentSkillService,
  SkillResourceResolverRegistry,
  referencedSkillSlugs,
} from '../services/agent-skill-service';

const ctx: RequestContext = {
  requestId: 'r-1', tenantId: 'tenant-a', userId: null, role: 'owner', operatorId: 'operator-1',
};

function setup(resourceExists = true) {
  const repo = {
    list: vi.fn().mockResolvedValue([]),
    catalog: vi.fn().mockResolvedValue([]),
    findGlobal: vi.fn().mockResolvedValue(null),
    findById: vi.fn(),
    findBySlug: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    createBinding: vi.fn(),
    deleteBinding: vi.fn(),
    listForResource: vi.fn().mockResolvedValue([]),
  };
  const registry = new SkillResourceResolverRegistry([{
    type: 'browser_profile', label: 'Perfil', list: vi.fn().mockResolvedValue([]),
    exists: vi.fn().mockResolvedValue(resourceExists),
  }]);
  return { repo, service: new AgentSkillService(repo as never, registry) };
}

describe('AgentSkillService', () => {
  it('extracts explicit skill references without treating arbitrary words as slugs', () => {
    expect(referencedSkillSlugs('Use skill:trello_skill e skill:torge_skill. trello_skill solto.')).toEqual([
      'trello_skill', 'torge_skill',
    ]);
  });

  it('returns non-blocking warnings for missing and disabled references', async () => {
    const { repo, service } = setup();
    repo.list.mockResolvedValue([
      { id: 'g', slug: 'company_global', markdown: 'Use skill:torge_skill e skill:trello_skill.', enabled: true, bindings: [] },
      { id: 't', slug: 'torge_skill', markdown: '', enabled: false, bindings: [] },
    ]);
    const result = await service.list(ctx);
    expect(result[0]!.warnings).toEqual([
      expect.objectContaining({ code: 'DISABLED_SKILL_REFERENCE', slug: 'torge_skill' }),
      expect.objectContaining({ code: 'MISSING_SKILL_REFERENCE', slug: 'trello_skill' }),
    ]);
  });

  it('loads a secondary skill using only the authenticated tenant', async () => {
    const { repo, service } = setup();
    repo.findBySlug.mockResolvedValue({ kind: 'secondary', slug: 'torge_skill', markdown: 'x' });
    await expect(service.load(ctx, 'torge_skill')).resolves.toMatchObject({ slug: 'torge_skill' });
    expect(repo.findBySlug).toHaveBeenCalledWith('tenant-a', 'torge_skill');
  });

  it('rejects binding a resource that does not belong to the tenant', async () => {
    const { repo, service } = setup(false);
    repo.findById.mockResolvedValue({ id: 'skill-1', kind: 'secondary' });
    await expect(service.bind(ctx, 'skill-1', {
      resourceType: 'browser_profile', resourceId: 'profile-from-tenant-b',
    })).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(repo.createBinding).not.toHaveBeenCalled();
  });

  it('rejects unknown resource types', async () => {
    const { repo, service } = setup();
    repo.findById.mockResolvedValue({ id: 'skill-1', kind: 'secondary' });
    await expect(service.bind(ctx, 'skill-1', {
      resourceType: 'unknown', resourceId: 'x',
    })).rejects.toBeInstanceOf(AppError);
  });

  it('keeps the global slug immutable through the API service', async () => {
    const { repo, service } = setup();
    repo.findById.mockResolvedValue({ id: 'global-1', kind: 'global', slug: 'company_global' });
    await expect(service.update(ctx, 'global-1', { slug: 'renamed_global' }))
      .rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
