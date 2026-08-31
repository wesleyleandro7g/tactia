import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://tactia:tactia@localhost:5433/tactia_test',
      // Test-only key (same all-zeros value as .env.example): the E2E exercises
      // the credential path, which requires a 32-byte key.
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? '0'.repeat(64),
    },
  },
});
