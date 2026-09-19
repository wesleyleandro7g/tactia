import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('../services', () => ({ tenantService: {}, userService: {}, tenantApiKeyService: {} }));
vi.mock('@tactia/database', () => ({ prisma: {} }));
const { captureConsultation } = vi.hoisted(() => ({
  captureConsultation: vi.fn().mockResolvedValue({ received: true }),
}));
vi.mock('@tactia/domain', () => ({
  AcquisitionLeadService: class {
    captureConsultation = captureConsultation;
  },
}));
import { POST } from '../../app/api/v1/consultation-leads/route';
import { auth } from '../auth';

let sequence = 0;
const routeContext = { params: Promise.resolve({}) };
function request(body: string, ip = 'consultation-test-' + sequence++) {
  return new Request('http://localhost/api/v1/consultation-leads', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
  });
}
beforeEach(() => {
  captureConsultation.mockClear();
});
describe('public consultation endpoint', () => {
  it('saves without requiring a session and returns no contact data', async () => {
    const response = await POST(request('{}'), routeContext);
    expect(response.status).toBe(201);
    expect((await response.json()).data).toEqual({ received: true });
    expect(auth.api.getSession).not.toHaveBeenCalled();
    expect(captureConsultation).toHaveBeenCalledOnce();
  });
  it('rejects malformed and oversized request bodies', async () => {
    expect((await POST(request('{'), routeContext)).status).toBe(400);
    expect((await POST(request('x'.repeat(17000)), routeContext)).status).toBe(400);
    expect(captureConsultation).not.toHaveBeenCalled();
  });
  it('limits anonymous submissions per IP', async () => {
    const ip = 'consultation-limit-' + sequence++;
    for (let i = 0; i < 5; i++) expect((await POST(request('{}', ip), routeContext)).status).toBe(201);
    expect((await POST(request('{}', ip), routeContext)).status).toBe(429);
    expect((await POST(request('{}'), routeContext)).status).toBe(201);
  });
});
