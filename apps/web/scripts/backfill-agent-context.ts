import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function main() {
  const [{ prisma }, { CompanyKnowledgeService }, { createEmbeddingAdapterFromEnv, createLLMAdapterFromEnv }] = await Promise.all([
    import('@tactia/database'),
    import('@tactia/chat/server'),
    import('@tactia/ai'),
  ]);
  const env = {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_CLASSIFIER_MODEL: process.env.LLM_CLASSIFIER_MODEL,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
  };
  const llm = createLLMAdapterFromEnv(env, 'classifier');
  if (!llm) throw new Error('Configure LLM_API_KEY antes de processar conversas antigas.');
  const knowledge = new CompanyKnowledgeService(prisma, llm, createEmbeddingAdapterFromEnv(env));

  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      let cursor: string | undefined;
      let processed = 0;
      while (true) {
        const conversations = await prisma.conversation.findMany({
          where: { tenantId: tenant.id },
          orderBy: { id: 'asc' }, take: 100,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          select: { id: true },
        });
        if (!conversations.length) break;
        for (const conversation of conversations) {
          await knowledge.summarizeConversation({
            requestId: 'agent-context-backfill', tenantId: tenant.id, userId: null, role: 'viewer',
          }, conversation.id);
          processed += 1;
        }
        cursor = conversations.at(-1)!.id;
        if (conversations.length < 100) break;
      }
      process.stdout.write(`${tenant.id}: ${processed} conversas examinadas\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
