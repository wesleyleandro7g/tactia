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
    '@tactia/domain',
    '@tactia/database',
    '@tactia/connectors',
    '@tactia/execution',
    '@tactia/ai',
    '@tactia/intelligence',
  ],
  // Keep WASM/native deps out of Turbopack so __dirname stays real (hb.wasm).
  serverExternalPackages: [
    'pino',
    'pino-pretty',
    '@prisma/client',
    '@resvg/resvg-js',
    'satori',
    'harfbuzzjs',
    'yoga-layout',
  ],
  // Keep TTF + harfbuzz wasm available in standalone/Docker builds.
  outputFileTracingIncludes: {
    '/infographics': [
      '../../packages/ai/src/infographics/fonts/**/*',
      '../../packages/ai/src/infographics/assets/**/*',
      './node_modules/@tactia/ai/src/infographics/fonts/**/*',
      './node_modules/@tactia/ai/src/infographics/assets/**/*',
      '../../node_modules/.pnpm/harfbuzzjs@*/node_modules/harfbuzzjs/hb.wasm',
      './node_modules/harfbuzzjs/hb.wasm',
    ],
    '/api/v1/infographics/preview': [
      '../../packages/ai/src/infographics/fonts/**/*',
      '../../packages/ai/src/infographics/assets/**/*',
      './node_modules/@tactia/ai/src/infographics/fonts/**/*',
      './node_modules/@tactia/ai/src/infographics/assets/**/*',
      '../../node_modules/.pnpm/harfbuzzjs@*/node_modules/harfbuzzjs/hb.wasm',
      './node_modules/harfbuzzjs/hb.wasm',
    ],
  },
  // Docker image (docker/Dockerfile): ships only the traced files.
  output: 'standalone',
  // Monorepo: trace from the repo root so workspace packages are included.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
};

export default nextConfig;
