import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://tactia:tactia@localhost:5433/tactia_test',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? '0'.repeat(64),
    },
  },
});
