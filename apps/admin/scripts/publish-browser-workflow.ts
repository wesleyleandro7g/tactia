import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  FigraniumWorkflowPublisher,
  figraniumConfigFromEnv,
  type VersionedWorkflow,
} from '@tactia/connectors';
import { BrowserWorkflowBindingRepository, prisma } from '@tactia/database';

async function main() {
  const [instanceKey, filePath, provider = 'platform'] = process.argv.slice(2);
  if (!instanceKey || !filePath) {
    throw new Error('Uso: pnpm --filter @tactia/admin publish:browser-workflow -- <instanceKey> <workflow.json> [provider]');
  }
  const raw = await readFile(filePath);
  const workflow = JSON.parse(raw.toString('utf8')) as VersionedWorkflow;
  const config = figraniumConfigFromEnv(instanceKey);
  const result = await new FigraniumWorkflowPublisher(config).publish(workflow);
  await new BrowserWorkflowBindingRepository(prisma).upsert({
    provider,
    engine: 'figranium',
    workflowKey: workflow.workflowKey,
    workflowVersion: workflow.workflowVersion,
    environment: process.env['TACTIA_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development',
    instanceKey,
    externalTaskId: result.taskId,
    definitionChecksum: createHash('sha256').update(raw).digest('hex'),
  });
  process.stdout.write(`${result.operation}: ${workflow.workflowKey}@${workflow.workflowVersion} -> ${result.taskId}\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
