import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@tactia/shared';
import { createId } from '@tactia/shared';

// Webhook handler: POST /api/v1/webhooks/:provider/:source
// Validates → logs raw event → returns 200
// Full processing pipeline (store → queue → canonicalize) is wired in the worker layer.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string; source: string }> },
) {
  const { provider, source } = await params;
  const requestId = createId();
  const log = logger.child({ requestId, provider, source });

  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const tenantId = request.headers.get('x-tenant-id') ?? request.nextUrl.searchParams.get('tenantId');

    log.info({ tenantId, payloadKeys: Object.keys(payload) }, 'Webhook received');

    // TODO: persist raw event + enqueue processing once worker infrastructure is wired (Etapa worker)
    return NextResponse.json({ ok: true, requestId });
  } catch (err) {
    log.error({ err }, 'Failed to parse webhook payload');
    return NextResponse.json({ ok: true }); // Always 200 to avoid external retries
  }
}
