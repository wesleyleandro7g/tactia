import path from 'path';
import type { NextConfig } from 'next';

const buildCpus = Number(process.env.NEXT_BUILD_CPUS || 0);

const nextConfig: NextConfig = {
  ...(buildCpus > 0
    ? {
        experimental: {
          cpus: buildCpus,
          webpackBuildWorker: true,
          webpackMemoryOptimizations: true,
        },
      }
    : {}),
  transpilePackages: [
    '@tactia/shared',
    '@tactia/chat',
    '@tactia/domain',
    '@tactia/database',
    '@tactia/execution',
    '@tactia/intelligence',
    '@tactia/ai',
  ],
  // Keep WASM/native deps out of Turbopack so satori can find hb.wasm.
  serverExternalPackages: [
    'pino',
    'pino-pretty',
    '@prisma/client',
    'pg-boss',
    '@resvg/resvg-js',
    'satori',
    'harfbuzzjs',
    'yoga-layout',
  ],
  outputFileTracingIncludes: {
    '/api/v1/conversations/[id]/messages': [
      '../../packages/ai/src/infographics/fonts/**/*',
      '../../packages/ai/src/infographics/assets/**/*',
      './node_modules/@tactia/ai/src/infographics/fonts/**/*',
      './node_modules/@tactia/ai/src/infographics/assets/**/*',
      '../../node_modules/.pnpm/harfbuzzjs@*/node_modules/harfbuzzjs/hb.wasm',
      './node_modules/harfbuzzjs/hb.wasm',
    ],
    '/api/v1/infographics/[id]': [
      '../../packages/ai/src/infographics/fonts/**/*',
      '../../packages/ai/src/infographics/assets/**/*',
      './node_modules/@tactia/ai/src/infographics/fonts/**/*',
      './node_modules/@tactia/ai/src/infographics/assets/**/*',
    ],
  },
  // Docker image (docker/Dockerfile): ships only the traced files.
  output: 'standalone',
  // Monorepo: trace from the repo root so workspace packages are included and
  // the build stops warning about the Prisma client location.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
};

export default nextConfig;
