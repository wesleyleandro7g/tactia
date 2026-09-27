import { createApiHandler } from '@/lib/api';
import { unbindAgentSkill } from '@/lib/agent-skills';
export const DELETE = createApiHandler({ auth: 'operator' }, (_request, ctx, params) => unbindAgentSkill(ctx, params['id']!, params['skillId']!, params['bindingId']!));
