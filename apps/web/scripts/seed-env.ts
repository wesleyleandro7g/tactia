import { loadEnvConfig } from '@next/env';
import { fileURLToPath } from 'node:url';

loadEnvConfig(fileURLToPath(new URL('..', import.meta.url)));

async function main() {
  const { prisma } = await import('@tactia/database');
  try {
    const [schema] = await prisma.$queryRaw<Array<{ flagPresent: boolean; historyPresent: boolean }>>`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'tenants'
            AND column_name = 'command_center_enabled'
        ) AS "flagPresent",
        to_regclass('public._prisma_migrations') IS NOT NULL AS "historyPresent"
    `;
    if (!schema?.flagPresent) {
      const history = schema?.historyPresent
        ? 'O histórico de migrações existe.'
        : 'O banco também não possui histórico _prisma_migrations; não rode migrate deploy diretamente sobre as tabelas existentes.';
      throw new Error(
        `O banco configurado ainda não tem tenants.command_center_enabled. ${history} Atualize o esquema antes do seed; veja docs/experiencia-central-comando/07-seed-demo.md.`,
      );
    }
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
  await import('./seed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
