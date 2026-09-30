import { REPORTS_PORTAL_WORKFLOW_KEY } from '@tactia/domain';
import type { PrismaClient } from '@tactia/database';
import type { AutomationBrowserPort, BrowserExportResult } from './ports';

export interface PublishedWorkflowRunner {
  run(input: {
    tenantId: string;
    runId: string;
    connectionId: string;
    workflowKey: string;
    workflowVersion: string;
    revisionId: string;
    parameters: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<BrowserExportResult>;
}

/**
 * Confere a revisão publicada e delega a coleta ao BrowserExecutor.
 * Não sintetiza arquivos: sem executor, a etapa falha.
 */
export function createReportsPortalBrowser(
  db: PrismaClient,
  runner: PublishedWorkflowRunner,
): AutomationBrowserPort {
  return {
    async execute(input) {
      const revision = await db.browserWorkflowRevision.findFirst({
        where: { id: input.revisionId, tenantId: input.tenantId },
        include: { workflow: true },
      });
      if (
        !revision ||
        revision.workflow.workflowKey !== input.workflowKey ||
        revision.workflowVersion !== input.workflowVersion
      ) {
        return {
          status: 'failed',
          retryable: false,
          message: 'A revisão fixada do workflow não está disponível.',
          files: [],
        };
      }
      if (input.signal.aborted) return { status: 'cancelled', retryable: false, files: [] };
      if (input.workflowKey !== REPORTS_PORTAL_WORKFLOW_KEY) {
        return {
          status: 'failed',
          retryable: false,
          message: 'Workflow de navegador não suportado nesta versão.',
          files: [],
        };
      }
      return runner.run(input);
    },
  };
}
