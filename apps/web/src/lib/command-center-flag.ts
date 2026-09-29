import { prisma } from '@tactia/database';

export async function hasCommandCenter(tenantId: string | null): Promise<boolean> {
  if (!tenantId) return false;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { commandCenterEnabled: true },
  });
  if (!tenant) return false;
  if (tenant.commandCenterEnabled !== null) return tenant.commandCenterEnabled;

  const allowed = (process.env.COMMAND_CENTER_TENANT_IDS ?? '')
    .split(',')
    .map((value) => value.trim());
  return allowed.includes('*') || allowed.includes(tenantId);
}
