import type { AuthProvider } from '@tactia/domain';
import { createId } from '@tactia/shared';
import { prisma } from '@tactia/database';
import { auth } from './auth';

export const betterAuthProvider: AuthProvider = {
  async createCredentialsUser(input) {
    const ctx = await auth.$context;
    const id = createId();
    const hash = await ctx.password.hash(input.password);
    await prisma.authUser.create({
      data: {
        id,
        name: input.name,
        email: input.email,
        emailVerified: true,
      },
    });
    await prisma.authAccount.create({
      data: {
        id: createId(),
        issuer: 'credential',
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: hash,
      },
    });
    return { externalAuthId: id };
  },
};
