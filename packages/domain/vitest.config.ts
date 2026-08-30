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
    },
  },
});
