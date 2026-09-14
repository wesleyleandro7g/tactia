import { OperatorRepository, prisma } from '@tactia/database';
import { OperatorService } from '@tactia/domain';
import { operatorAuthProvider } from '../src/lib/auth-provider';

const email = process.env.TACTIA_BOOTSTRAP_OPERATOR_EMAIL?.trim();
const password = process.env.TACTIA_BOOTSTRAP_OPERATOR_PASSWORD;
const name = process.env.TACTIA_BOOTSTRAP_OPERATOR_NAME?.trim() || 'Operador';

async function main() {
  if (!email || !password) {
    console.error(
      'Defina TACTIA_BOOTSTRAP_OPERATOR_EMAIL e TACTIA_BOOTSTRAP_OPERATOR_PASSWORD para criar o primeiro operador.',
    );
    process.exit(1);
  }

  const service = new OperatorService(new OperatorRepository(prisma), operatorAuthProvider);
  const operator = await service.bootstrap({ name, email, password });
  console.log(`Operador pronto: ${operator.email} (${operator.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
