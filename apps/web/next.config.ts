import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@tactia/shared', '@tactia/domain', '@tactia/database'],
  serverExternalPackages: ['pino', 'pino-pretty', '@prisma/client'],
};

export default nextConfig;
