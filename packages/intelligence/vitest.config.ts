import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each test file runs in its own worker sequentially to avoid Postgres conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://tactia:tactia@localhost:5433/tactia_test',
    },
  },
});
