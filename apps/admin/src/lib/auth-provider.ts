import type { AuthProvider } from '@tactia/domain';
import { createId } from '@tactia/shared';
import { prisma } from '@tactia/database';
import { createLocalAccountIssuer } from 'better-auth/db';
import { operatorAuth } from './auth';

const CREDENTIAL_ISSUER = createLocalAccountIssuer('credential');

async function hashPassword(password: string) {
  const ctx = await operatorAuth.$context;
  return ctx.password.hash(password);
}

export const clientAuthProvider: AuthProvider = {
  async createCredentialsUser(input) {
    const id = createId();
    const hash = await hashPassword(input.password);
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
    const hash = await hashPassword(password);
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

export const operatorAuthProvider: AuthProvider = {
  async createCredentialsUser(input) {
    const id = createId();
    const hash = await hashPassword(input.password);
    await prisma.operatorAuthUser.create({
      data: {
        id,
        name: input.name,
        email: input.email.toLowerCase(),
        emailVerified: true,
      },
    });
    await prisma.operatorAuthAccount.create({
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
    const hash = await hashPassword(password);
    const updated = await prisma.operatorAuthAccount.updateMany({
      where: { userId: externalAuthId, providerId: 'credential' },
      data: { password: hash },
    });
    if (updated.count === 0) {
      await prisma.operatorAuthAccount.create({
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
