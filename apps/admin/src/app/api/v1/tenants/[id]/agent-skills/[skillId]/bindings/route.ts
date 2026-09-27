import { createApiHandler, readJson } from '@/lib/api';
import { bindAgentSkill } from '@/lib/agent-skills';
export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => bindAgentSkill(ctx, params['id']!, params['skillId']!, await readJson(request)));
