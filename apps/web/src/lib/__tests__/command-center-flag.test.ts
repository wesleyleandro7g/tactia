import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@tactia/database';
import { createId } from '@tactia/shared';
import { hasCommandCenter } from '../command-center-flag';

const tenantId = createId();
const previousEnv = process.env.COMMAND_CENTER_TENANT_IDS;

beforeAll(async () => {
  await prisma.tenant.create({
    data: { id: tenantId, name: 'Flag Test', slug: `flag-test-${tenantId}` },
  });
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } });
  if (previousEnv === undefined) delete process.env.COMMAND_CENTER_TENANT_IDS;
  else process.env.COMMAND_CENTER_TENANT_IDS = previousEnv;
  await prisma.$disconnect();
});

describe('command center tenant flag', () => {
  it('uses the environment only before Ops records an explicit choice', async () => {
    process.env.COMMAND_CENTER_TENANT_IDS = tenantId;
    expect(await hasCommandCenter(tenantId)).toBe(true);

    await prisma.tenant.update({ where: { id: tenantId }, data: { commandCenterEnabled: false } });
    expect(await hasCommandCenter(tenantId)).toBe(false);

    process.env.COMMAND_CENTER_TENANT_IDS = '';
    await prisma.tenant.update({ where: { id: tenantId }, data: { commandCenterEnabled: true } });
    expect(await hasCommandCenter(tenantId)).toBe(true);
  });

  it('does not enable a missing tenant or absent context', async () => {
    process.env.COMMAND_CENTER_TENANT_IDS = '*';
    expect(await hasCommandCenter(createId())).toBe(false);
    expect(await hasCommandCenter(null)).toBe(false);
  });
});
