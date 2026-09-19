import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@tactia/database';
import { AcquisitionLeadService } from '@tactia/domain';
import { createId } from '@tactia/shared';
import { auth } from '../auth';

const service = new AcquisitionLeadService(prisma);
const id = createId();
const email = id + '@acquisition-login.test';
const operatorId = createId();
const operatorAuthId = createId();
let tenantId: string | undefined;
let userId: string | undefined;
let clientAuthId: string | undefined;

afterAll(async () => {
  await prisma.acquisitionLead.deleteMany({ where: { submissionId: id } });
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } });
  if (userId) await prisma.user.delete({ where: { id: userId } });
  if (clientAuthId) await prisma.authUser.delete({ where: { id: clientAuthId } });
  await prisma.operator.deleteMany({ where: { id: operatorId } });
  await prisma.operatorAuthUser.deleteMany({ where: { id: operatorAuthId } });
  await prisma.$disconnect();
});

describe('operator provisioned client login', () => {
  it('accepts the credentials created during lead conversion while signup stays disabled', async () => {
    await prisma.operatorAuthUser.create({
      data: { id: operatorAuthId, name: 'Test', email: 'ops-' + email, emailVerified: true },
    });
    await prisma.operator.create({
      data: { id: operatorId, externalAuthId: operatorAuthId, name: 'Test', email: 'ops-' + email },
    });
    await service.capture({
      submissionId: id,
      name: 'Cliente Teste',
      email,
      whatsapp: '11999991234',
      company: 'Teste',
      segment: 'Serviços',
      employeeRange: 'Só eu',
      revenueRange: 'Prefiro não informar',
      systems: ['Nenhum'],
    });
    const lead = await prisma.acquisitionLead.findUniqueOrThrow({ where: { submissionId: id } });
    const password = 'temporary-test-password';
    const authContext = await auth.$context;
    const result = await service.convert(
      { requestId: createId(), operatorId, tenantId: null, userId: null, role: null },
      lead.id,
      {
        name: 'Teste',
        slug: 'login-' + id,
        ownerName: 'Cliente Teste',
        ownerEmail: email,
        ownerPassword: password,
      },
      { hashPassword: authContext.password.hash, issuer: 'local:credential' },
    );
    tenantId = result.tenant.id;
    userId = result.user.id;
    clientAuthId = result.user.externalAuthId;
    const session = await auth.api.signInEmail({ body: { email, password } });
    expect(session.user.id).toBe(clientAuthId);
    expect(session.token).toBeTruthy();
    await expect(
      auth.api.signUpEmail({ body: { name: 'Blocked', email: 'blocked-' + email, password } }),
    ).rejects.toMatchObject({ body: { code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' } });
  });
});
