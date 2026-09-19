import { createLocalAccountIssuer } from 'better-auth/db';
import { createApiHandler, readJson } from '@/lib/api';
import { acquisitionLeadService } from '@/lib/acquisition';
import { operatorAuth } from '@/lib/auth';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    const authContext = await operatorAuth.$context;
    return acquisitionLeadService.convert(ctx, params.id ?? '', await readJson(request), {
      hashPassword: authContext.password.hash,
      issuer: createLocalAccountIssuer('credential'),
    });
  },
);
