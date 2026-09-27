import { createApiHandler, readJson } from '@/lib/api';
import { createAgentSkill, listAgentSkills } from '@/lib/agent-skills';
export const GET = createApiHandler({ auth: 'operator' }, (_request, ctx, params) => listAgentSkills(ctx, params['id']!));
export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => createAgentSkill(ctx, params['id']!, await readJson(request)));
