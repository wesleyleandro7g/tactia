import { prisma } from '@tactia/database';

export async function hasAutomations(tenantId: string | null): Promise<boolean> {
  if (!tenantId) return false;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { automationsEnabled: true },
  });
  return tenant?.automationsEnabled === true;
}
