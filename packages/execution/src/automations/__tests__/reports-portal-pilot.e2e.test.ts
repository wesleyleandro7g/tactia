import { createServer, type IncomingMessage, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { executePublishedFigraniumWorkflow, renderReportCsv, reportsPortalVersionBody } from '@tactia/domain';
import type { RequestContext } from '@tactia/shared';
import { createReportsPortalBrowser } from '../reports-browser';
import { MemoryAutomationStore } from '../memory-store';
import { AutomationService } from '../service';
import { SmtpEmailSender } from '../../smtp-email-sender';

const TENANT = 'tenant-demo';
const CONNECTION = '11111111-1111-4111-8111-111111111111';
const API_KEY = 'pilot-key';

function ctx(): RequestContext {
  return {
    requestId: 'req-e2e',
    tenantId: TENANT,
    userId: 'user-1',
    role: 'owner',
    operatorId: 'operator-1',
    ip: null,
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('porta indisponível');
  return address.port;
}

describe('reports portal pilot', () => {
  it('collects portal CSVs through Figranium and sends them by capture SMTP', async () => {
    const files = new Map<string, Buffer>();
    let portalDownloads = 0;
    let port = 0;
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.headers['x-api-key'] && request.headers['x-api-key'] !== API_KEY) {
        response.writeHead(401).end();
        return;
      }
      if (url.pathname === '/demo/reports-portal' && request.method === 'POST') {
        const body = JSON.parse(await readBody(request)) as { password?: string };
        if (body.password !== 'demo-reports') {
          response.writeHead(401).end();
          return;
        }
        response.writeHead(204, { 'set-cookie': 'tactia_demo_reports=ok; Path=/' }).end();
        return;
      }
      if (url.pathname.startsWith('/demo/reports-portal/reports/')) {
        if (!String(request.headers.cookie ?? '').includes('tactia_demo_reports=ok')) {
          response.writeHead(401).end();
          return;
        }
        const kind = url.pathname.split('/').pop() ?? '';
        const from = url.searchParams.get('from') ?? '';
        const to = url.searchParams.get('to') ?? '';
        portalDownloads += 1;
        response.writeHead(200, { 'content-type': 'text/csv' }).end(renderReportCsv(kind as 'sales', from, to));
        return;
      }
      if (url.pathname === '/api/tasks/task-reports/api' && request.method === 'POST') {
        const body = JSON.parse(await readBody(request)) as { variables?: Record<string, unknown> };
        const variables = body.variables ?? {};
        const origin = `http://127.0.0.1:${port}`;
        const login = await fetch(`${origin}/demo/reports-portal`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'demo-reports' }),
        });
        const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
        const reports = Array.isArray(variables['reports']) ? variables['reports'].map(String) : ['sales', 'inventory', 'financial'];
        const downloads = [];
        for (const kind of reports) {
          const csv = await fetch(
            `${origin}/demo/reports-portal/reports/${kind}?from=${encodeURIComponent(String(variables['periodStart'] ?? ''))}&to=${encodeURIComponent(String(variables['periodEnd'] ?? ''))}`,
            { headers: { cookie } },
          );
          const path = `/api/cabinets/portal/items/${kind}/download`;
          files.set(path, Buffer.from(await csv.arrayBuffer()));
          downloads.push({ path, name: `${kind}.csv` });
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ outcome: 'success', downloads }));
        return;
      }
      if (url.pathname.startsWith('/api/cabinets/') && request.method === 'GET') {
        const body = files.get(url.pathname);
        if (!body) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'text/csv' }).end(body);
        return;
      }
      response.writeHead(404).end();
    });
    port = await listen(server);
    const captured: Array<{ to: string; attachments: Array<{ filename: string; content: Buffer }> }> = [];
    const sender = new SmtpEmailSender(
      {
        provider: 'custom',
        host: '127.0.0.1',
        port: 2525,
        secure: false,
        username: 'capture',
        password: 'capture',
        fromEmail: 'ops@demo.tactia',
      },
      () => ({
        async sendMail(options) {
          captured.push({
            to: options.to,
            attachments: (options.attachments ?? []).map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
            })),
          });
          return { messageId: '<capture@local>' };
        },
        async verify() {
          return true;
        },
      }),
    );

    try {
      const anonymous = await fetch(`http://127.0.0.1:${port}/demo/reports-portal/reports/sales?from=2026-09-01&to=2026-09-30`);
      expect(anonymous.status).toBe(401);

      const objects = new Map<string, { name: string; body: Buffer }>();
      const store = new MemoryAutomationStore([TENANT]);
      const service = new AutomationService({
        store,
        revisions: { async pin() { return 'rev-e2e'; } },
        publish: async () => undefined,
        storage: {
          async put({ id, body }) {
            const key = `mem/${id}.csv`;
            objects.set(key, { name: id, body });
            return { key };
          },
          async get(key) {
            const object = objects.get(key);
            if (!object) throw new Error('missing');
            return { body: object.body, contentType: 'text/csv' };
          },
        },
        browser: createReportsPortalBrowser(
          {
            browserWorkflowRevision: {
              findFirst: async () => ({
                id: 'rev-e2e',
                workflowVersion: '1',
                workflow: { workflowKey: 'tactia.reports-portal' },
              }),
            },
          } as never,
          {
            async run(input) {
              return executePublishedFigraniumWorkflow(
                {
                  instanceKey: 'pilot',
                  baseUrl: `http://127.0.0.1:${port}`,
                  apiKey: API_KEY,
                  dedicatedConnectionId: CONNECTION,
                  allowInsecureHttp: true,
                  workflows: [{ workflowKey: 'tactia.reports-portal', workflowVersion: '1', taskId: 'task-reports' }],
                },
                {
                  executionKey: input.runId,
                  connectionId: input.connectionId,
                  sessionScope: input.runId,
                  workflowKey: input.workflowKey,
                  workflowVersion: input.workflowVersion,
                  parameters: input.parameters,
                  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
                  signal: input.signal,
                },
              );
            },
          },
        ),
        effects: {
          async propose(input) {
            const artifacts = await store.listArtifacts(TENANT, input.idempotencyKey.split(':')[1] ?? '');
            const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact.name]));
            const result = await sender.send({
              to: input.email.to,
              subject: input.email.subject,
              body: input.email.body,
              attachments: input.email.artifactIds.map((id) => ({
                filename: byId.get(id) ?? `${id}.csv`,
                content: objects.get(`mem/${id}.csv`)?.body ?? Buffer.alloc(0),
                contentType: 'text/csv',
              })),
            });
            return { status: 'completed', actionExecutionId: 'smtp-1', approvalId: null, output: { messageId: result.id } };
          },
          async lookup() {
            return null;
          },
        },
      });

      const draft = await service.createDraft(ctx(), 'reports.portal');
      const version = await service.updateDraft(
        ctx(),
        draft.id,
        reportsPortalVersionBody({
          connectionId: CONNECTION,
          preauthorizedRecipients: ['ops@demo.tactia'],
          revisionId: 'rev-e2e',
        }),
      );
      await service.publish(ctx(), draft.id, version.versionId);
      const queued = await service.start(
        { ...ctx(), role: 'member', operatorId: null },
        {
          automationId: draft.id,
          params: {
            periodStart: '2026-09-01',
            periodEnd: '2026-09-30',
            reports: ['sales', 'inventory', 'financial'],
            recipient: 'ops@demo.tactia',
          },
          origin: 'page',
          idempotencyKey: 'pilot-e2e',
        },
      );
      expect(await service.execute(TENANT, queued.id)).toBe('done');
      const done = await service.getRun(ctx(), draft.id, queued.id);
      expect(done.status).toBe('completed');
      expect(done.artifacts.map((artifact) => artifact.name).sort()).toEqual(['financial.csv', 'inventory.csv', 'sales.csv']);
      expect(portalDownloads).toBe(3);
      expect(captured).toHaveLength(1);
      expect(captured[0]?.to).toBe('ops@demo.tactia');
      const expected = ['sales', 'inventory', 'financial'].map((kind) => renderReportCsv(kind as 'sales', '2026-09-01', '2026-09-30'));
      const received = (captured[0]?.attachments ?? []).map((attachment) => attachment.content.toString('utf8')).sort();
      expect(received).toEqual([...expected].sort());
    } finally {
      server.close();
    }
  });
});
