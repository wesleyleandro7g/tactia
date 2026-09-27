import { NextResponse, type NextRequest } from 'next/server';
import {
  computeChecksum,
  sanitizeTrelloPayload,
  trelloCallbackUrl,
  verifyTrelloWebhookSignature,
} from '@tactia/domain';
import { createId, logger } from '@tactia/shared';
import { dataSourceRepository, rawRecordRepository, syncService } from '@/lib/services';

export async function HEAD(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string; source: string }> },
) {
  const { provider } = await params;
  return new NextResponse(null, { status: provider === 'trello' ? 200 : 405 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string; source: string }> },
) {
  const { provider, source } = await params;
  const requestId = createId();
  const log = logger.child({ request_id: requestId, provider, source });

  if (provider !== 'trello') {
    try {
      const payload = (await request.json()) as Record<string, unknown>;
      log.info({ payload_keys: Object.keys(payload) }, 'Webhook received');
    } catch (error) {
      log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Invalid webhook payload');
    }
    return NextResponse.json({ ok: true, requestId });
  }

  const tenantId = request.nextUrl.searchParams.get('tenantId');
  if (!tenantId) return NextResponse.json({ ok: false }, { status: 400 });

  const rawBody = await request.text();
  const webhookSecrets = [
    process.env['TRELLO_OAUTH_CLIENT_SECRET']?.trim(),
    process.env['TRELLO_APP_SECRET']?.trim(),
  ].filter((value): value is string => Boolean(value));
  let callbackUrl: string;
  try {
    callbackUrl = trelloCallbackUrl(source, tenantId);
  } catch {
    log.error({ operation: 'trello_webhook_config', status: 'failed' }, 'Trello callback URL is not configured');
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const signature = request.headers.get('x-trello-webhook');
  const signatureValid = webhookSecrets.some((secret) => verifyTrelloWebhookSignature({
    rawBody,
    callbackUrl,
    secret,
    signature,
  }));
  if (!signatureValid) {
    log.warn({ tenant_id: tenantId, operation: 'trello_webhook_verify', status: 'rejected' }, 'Invalid Trello webhook signature');
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const dataSource = await dataSourceRepository.findOwned({ tenantId, id: source });
  if (!dataSource || dataSource.type !== 'trello') return NextResponse.json({ ok: false }, { status: 404 });
  if (dataSource.status === 'inactive') return new NextResponse(null, { status: 410 });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const action = parsed['action'] && typeof parsed['action'] === 'object'
    ? parsed['action'] as Record<string, unknown>
    : {};
  const actionId = typeof action['id'] === 'string' ? action['id'] : null;
  if (!actionId) return NextResponse.json({ ok: false }, { status: 400 });

  const payload = sanitizeTrelloPayload(parsed) as Record<string, unknown>;
  const result = await rawRecordRepository.upsertByKey({
    tenantId,
    dataSourceId: source,
    externalId: actionId,
    entityType: 'trello:webhook',
    payload,
    checksum: computeChecksum(payload),
  });
  const sanitizedAction = sanitizeTrelloPayload(action) as Record<string, unknown>;
  await rawRecordRepository.upsertByKey({
    tenantId,
    dataSourceId: source,
    externalId: actionId,
    entityType: 'trello:actions',
    payload: sanitizedAction,
    checksum: computeChecksum(sanitizedAction),
  });
  await dataSourceRepository.update({
    tenantId,
    id: source,
    data: {
      configuration: {
        ...((dataSource.configuration ?? {}) as Record<string, unknown>),
        webhookStatus: 'active',
        webhookLastReceivedAt: new Date().toISOString(),
      },
    },
  });

  if (result.created) {
    try {
      await syncService.startSystemSync(tenantId, source, { requestId });
    } catch (error) {
      log.error({
        tenant_id: tenantId,
        operation: 'trello_webhook_enqueue',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.info({
    tenant_id: tenantId,
    operation: 'trello_webhook_receive',
    action_id: actionId,
    duplicate: !result.created,
    status: 'accepted',
  });
  return NextResponse.json({ ok: true, requestId });
}
