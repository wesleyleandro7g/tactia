import { createApiHandler } from '@/lib/api';
import { automationService } from '@/lib/automations';

export const POST = createApiHandler({ auth: 'none' }, async (request, _ctx, params) => {
  const raw = await request.text();
  return automationService.acceptWebhook(
    params['triggerId']!,
    {
      timestamp: request.headers.get('x-tactia-timestamp'),
      signature: request.headers.get('x-tactia-signature'),
      eventId: request.headers.get('x-tactia-event-id'),
    },
    raw,
  );
});
