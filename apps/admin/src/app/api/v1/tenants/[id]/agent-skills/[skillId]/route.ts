import { createApiHandler, readJson } from '@/lib/api';
import { deleteAgentSkill, updateAgentSkill } from '@/lib/agent-skills';
export const PATCH = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => updateAgentSkill(ctx, params['id']!, params['skillId']!, await readJson(request)));
export const DELETE = createApiHandler({ auth: 'operator' }, (_request, ctx, params) => deleteAgentSkill(ctx, params['id']!, params['skillId']!));
