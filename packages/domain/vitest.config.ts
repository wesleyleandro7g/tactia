import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://tactia:tactia@localhost:5433/tactia_test',
      // Test-only key (all zeros, same as .env.example): the credential path
      // needs a 32-byte AES key to encrypt the external Postgres password.
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? '0'.repeat(64),
    },
  },
});
