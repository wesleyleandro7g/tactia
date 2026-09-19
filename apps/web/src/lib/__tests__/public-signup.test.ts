import { describe, expect, it } from 'vitest';
import { auth } from '../auth';

describe('Better Auth public signup', () => {
  it('rejects account creation at the auth provider', async () => {
    await expect(
      auth.api.signUpEmail({
        body: { name: 'Blocked', email: 'blocked@acquisition.test', password: 'password123' },
      }),
    ).rejects.toMatchObject({
      body: { code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' },
    });
  });
});
