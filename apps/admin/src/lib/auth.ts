import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { prisma } from '@tactia/database';

const secret = process.env.ADMIN_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
const baseURL =
  process.env.ADMIN_AUTH_URL ?? process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3001';

if (!secret && process.env.NODE_ENV !== 'test') {
  console.warn('ADMIN_AUTH_SECRET is not set');
}

export const operatorAuth = betterAuth({
  appName: 'Tactia Ops',
  baseURL,
  basePath: '/api/v1/auth',
  secret: secret ?? 'dev-only-admin-secret-replace-before-prod-32',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
  },
  user: {
    modelName: 'operatorAuthUser',
  },
  session: {
    modelName: 'operatorAuthSession',
  },
  account: {
    modelName: 'operatorAuthAccount',
  },
  verification: {
    modelName: 'operatorAuthVerification',
  },
  advanced: {
    cookiePrefix: 'tactia-ops',
  },
  trustedOrigins: [baseURL],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const { operatorService } = await import('./services');
          await operatorService.ensureFromExternalAuth({
            externalAuthId: user.id,
            name: user.name,
            email: user.email,
          });
        },
      },
    },
  },
  plugins: [nextCookies()],
});
