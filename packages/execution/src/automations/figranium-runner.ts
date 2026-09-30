import { executePublishedFigraniumWorkflow } from '@tactia/domain';
import type { PrismaClient } from '@tactia/database';
import type { PublishedWorkflowRunner } from './reports-browser';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_BUDGET_MS = 10 * 60_000;

const UNAVAILABLE = {
  status: 'failed' as const,
  retryable: false,
  message: 'Executor de navegador indisponível para esta conexão.',
  files: [],
};

/**
 * Resolve a instância Figranium dedicada à conexão e executa o workflow publicado.
 * Sem instância, a etapa falha. Arquivos só entram se o executor os entregar.
 */
export function createPublishedWorkflowRunner(
  db: PrismaClient,
  decrypt: (value: string) => string,
): PublishedWorkflowRunner {
  return {
    async run(input) {
      if (!UUID.test(input.connectionId)) return UNAVAILABLE;
      const instance = await db.browserExecutorInstance.findFirst({
        where: {
          tenantId: input.tenantId,
          dedicatedConnectionId: input.connectionId,
          active: true,
          engine: 'figranium',
        },
        include: {
          apiKeyCredential: true,
          bindings: { where: { active: true } },
        },
      });
      if (!instance?.dedicatedConnectionId || !instance.apiKeyCredential) return UNAVAILABLE;
      let apiKey = '';
      try {
        const data = JSON.parse(decrypt(instance.apiKeyCredential.encryptedData)) as { apiKey?: unknown };
        apiKey = typeof data.apiKey === 'string' ? data.apiKey : '';
      } catch {
        return { ...UNAVAILABLE, message: 'Credencial do executor indisponível.' };
      }
      if (!apiKey) return { ...UNAVAILABLE, message: 'Executor de navegador sem autenticação.' };
      return executePublishedFigraniumWorkflow(
        {
          instanceKey: instance.instanceKey,
          baseUrl: instance.baseUrl,
          apiKey,
          dedicatedConnectionId: instance.dedicatedConnectionId,
          allowInsecureHttp: instance.allowInsecureHttp,
          workflows: instance.bindings.map((binding) => ({
            workflowKey: binding.workflowKey,
            workflowVersion: binding.workflowVersion,
            taskId: binding.externalTaskId,
          })),
        },
        {
          executionKey: input.runId,
          connectionId: input.connectionId,
          sessionScope: input.runId,
          workflowKey: input.workflowKey,
          workflowVersion: input.workflowVersion,
          parameters: input.parameters,
          deadlineAt: new Date(Date.now() + RUN_BUDGET_MS).toISOString(),
          signal: input.signal,
        },
      );
    },
  };
}
