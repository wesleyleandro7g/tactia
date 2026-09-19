import type { AuthProvider } from '@tactia/domain';
import { createId } from '@tactia/shared';
import { prisma } from '@tactia/database';
import { auth } from './auth';

const CREDENTIAL_ISSUER = 'local:credential';

export const betterAuthProvider: AuthProvider = {
  async createCredentialsUser(input) {
    const ctx = await auth.$context;
    const id = createId();
    const hash = await ctx.password.hash(input.password);
    await prisma.authUser.create({
      data: {
        id,
        name: input.name,
        email: input.email.toLowerCase(),
        emailVerified: true,
      },
    });
    await prisma.authAccount.create({
      data: {
        id: createId(),
        issuer: CREDENTIAL_ISSUER,
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: hash,
      },
    });
    return { externalAuthId: id };
  },

  async setPassword(externalAuthId, password) {
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(password);
    const updated = await prisma.authAccount.updateMany({
      where: { userId: externalAuthId, providerId: 'credential' },
      data: { password: hash },
    });
    if (updated.count === 0) {
      await prisma.authAccount.create({
        data: {
          id: createId(),
          issuer: CREDENTIAL_ISSUER,
          accountId: externalAuthId,
          providerId: 'credential',
          userId: externalAuthId,
          password: hash,
        },
      });
    }
  },
};
