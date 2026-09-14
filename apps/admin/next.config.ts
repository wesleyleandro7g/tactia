import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@tactia/shared',
    '@tactia/domain',
    '@tactia/database',
    '@tactia/connectors',
    '@tactia/execution',
  ],
  serverExternalPackages: ['pino', 'pino-pretty', '@prisma/client'],
  // Docker image (docker/Dockerfile): ships only the traced files.
  output: 'standalone',
  // Monorepo: trace from the repo root so workspace packages are included.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
};

export default nextConfig;
