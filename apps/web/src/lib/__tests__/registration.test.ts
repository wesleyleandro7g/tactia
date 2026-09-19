import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('../services', () => ({
  tenantService: { listForUser: vi.fn(), create: vi.fn() },
  userService: { list: vi.fn(), create: vi.fn() },
  membershipService: { list: vi.fn(), create: vi.fn() },
  tenantApiKeyService: {},
}));
import { POST as tenantPost } from '../../app/api/v1/tenants/route';
import { POST as userPost } from '../../app/api/v1/users/route';
import { POST as membershipPost } from '../../app/api/v1/memberships/route';
import { auth } from '../auth';
import { tenantService, userService, membershipService } from '../services';

const routeContext = { params: Promise.resolve({}) };

describe('operator-only registration', () => {
  it.each([tenantPost, userPost, membershipPost])(
    'rejects direct calls without touching credentials or session',
    async (post) => {
      const response = await post(
        new Request('http://localhost/api/v1/tenants', {
          method: 'POST',
          headers: { cookie: 'existing-client-session' },
          body: JSON.stringify({ name: 'Attempt' }),
        }),
        routeContext,
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.message).toContain('equipe Tactia');
      expect(auth.api.getSession).not.toHaveBeenCalled();
      expect(tenantService.create).not.toHaveBeenCalled();
      expect(userService.create).not.toHaveBeenCalled();
      expect(membershipService.create).not.toHaveBeenCalled();
    },
  );
});
