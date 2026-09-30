import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BrowserWorkflowRepository, prisma } from '@tactia/database';
import {
  REPORTS_PORTAL_WORKFLOW_KEY,
  REPORTS_PORTAL_WORKFLOW_VERSION,
  reportsPortalVersionBody,
} from '@tactia/domain';
import type { RequestContext } from '@tactia/shared';
import { automationService } from '../src/lib/automations';

const tenantId = process.env['AUTOMATIONS_DEMO_TENANT_ID']?.trim();
if (!tenantId) throw new Error('Defina AUTOMATIONS_DEMO_TENANT_ID.');

const ctx: RequestContext = {
  requestId: 'seed-automations',
  tenantId,
  userId: null,
  role: 'owner',
  operatorId: 'seed-automations',
  ip: null,
};

async function main() {
  await prisma.tenant.update({ where: { id: tenantId! }, data: { automationsEnabled: true } });
  const file = path.resolve(
    process.cwd(),
    '../../packages/connectors/src/browser/engines/figranium/workflows/reports-portal.v1.json',
  );
  const raw = await readFile(file, 'utf8');
  const environment = process.env['TACTIA_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development';
  await new BrowserWorkflowRepository(prisma).importRevision(
    {
      tenantId: tenantId!,
      provider: 'tactia',
      engine: 'figranium',
      workflowKey: REPORTS_PORTAL_WORKFLOW_KEY,
      environment,
    },
    {
      workflowVersion: REPORTS_PORTAL_WORKFLOW_VERSION,
      definition: JSON.parse(raw) as object,
      definitionChecksum: createHash('sha256').update(raw).digest('hex'),
      publishable: true,
      createdBy: 'seed',
    },
  );

  const page = await automationService.list(ctx);
  if (!page.items.some((item) => item.status === 'published')) {
    const draft = await automationService.createDraft(ctx, 'reports.portal');
    const updated = await automationService.updateDraft(
      ctx,
      draft.id,
      reportsPortalVersionBody({
        connectionId: 'demo-reports-portal',
        preauthorizedRecipients: (process.env['AUTOMATIONS_DEMO_RECIPIENT'] ?? 'ops@demo.tactia')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      }),
    );
    await automationService.publish(ctx, draft.id, updated.versionId);
  }
  process.stdout.write(`Automações habilitadas para ${tenantId}\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
