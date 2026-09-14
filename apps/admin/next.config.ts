import path from 'path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

const repoRoot = path.join(import.meta.dirname, '../..');
loadEnvConfig(repoRoot);

const nextConfig: NextConfig = {
  transpilePackages: [
    '@tactia/shared',
    '@tactia/domain',
    '@tactia/database',
    '@tactia/connectors',
    '@tactia/execution',
  ],
  serverExternalPackages: ['pino', 'pino-pretty', '@prisma/client'],
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
};

export default nextConfig;
