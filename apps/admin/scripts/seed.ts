import { loadEnvConfig } from '@next/env';
import { fileURLToPath } from 'node:url';

loadEnvConfig(fileURLToPath(new URL('..', import.meta.url)));

async function main() {
  const email = process.env.TACTIA_BOOTSTRAP_OPERATOR_EMAIL?.trim();
  const password = process.env.TACTIA_BOOTSTRAP_OPERATOR_PASSWORD;
  const name = process.env.TACTIA_BOOTSTRAP_OPERATOR_NAME?.trim() || 'Operador';
  if (!email || !password) {
    console.error(
      'Defina TACTIA_BOOTSTRAP_OPERATOR_EMAIL e TACTIA_BOOTSTRAP_OPERATOR_PASSWORD para criar o primeiro operador.',
    );
    process.exit(1);
  }

  const [{ OperatorRepository, prisma }, { OperatorService }, { operatorAuthProvider }] = await Promise.all([
    import('@tactia/database'),
    import('@tactia/domain'),
    import('../src/lib/auth-provider'),
  ]);
  try {
    const service = new OperatorService(new OperatorRepository(prisma), operatorAuthProvider);
    const operator = await service.bootstrap({ name, email, password });
    console.log(`Operador pronto: ${operator.email} (${operator.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
