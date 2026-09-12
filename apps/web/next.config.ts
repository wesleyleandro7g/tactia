import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@tactia/shared', '@tactia/domain', '@tactia/database', '@tactia/execution', '@tactia/intelligence'],
  serverExternalPackages: ['pino', 'pino-pretty', '@prisma/client', 'pg-boss'],
  // Docker image (docker/Dockerfile): ships only the traced files.
  output: 'standalone',
  // Monorepo: trace from the repo root so workspace packages are included and
  // the build stops warning about the Prisma client location.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
};

export default nextConfig;
