import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { prisma } from '@tactia/database';

const secret = process.env.BETTER_AUTH_SECRET;
const baseURL = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

if (!secret && process.env.NODE_ENV !== 'test') {
  console.warn('BETTER_AUTH_SECRET is not set');
}

export const auth = betterAuth({
  appName: 'Tactia',
  baseURL,
  basePath: '/api/v1/auth',
  secret: secret ?? 'dev-only-secret-replace-before-production-32',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  user: {
    modelName: 'authUser',
  },
  session: {
    modelName: 'authSession',
  },
  account: {
    modelName: 'authAccount',
  },
  verification: {
    modelName: 'authVerification',
  },
  trustedOrigins: [baseURL],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const { userService } = await import('./services');
          await userService.ensureFromExternalAuth({
            externalAuthId: user.id,
            name: user.name,
            email: user.email,
            avatarUrl: user.image,
          });
        },
      },
    },
  },
  plugins: [nextCookies()],
});
