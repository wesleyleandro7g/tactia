import { type PrismaClient, toVectorLiteral } from '@tactia/database';
import type { LLMAdapter } from '@tactia/ai';
import { AppError, ErrorCode, createId, logger, type RequestContext } from '@tactia/shared';
import { z } from 'zod';

const profileInput = z.object({
  industry: z.string().trim().max(1000),
  offering: z.string().trim().max(2000),
  customers: z.string().trim().max(1500),
  geography: z.string().trim().max(1000),
  positioning: z.string().trim().max(1500),
  priorities: z.string().trim().max(2000),
}).strict();

const summaryInput = z.object({ text: z.string().trim().min(1).max(3000) }).strict();

type Embedder = { embed(texts: string[]): Promise<number[][]> };

function tenantId(ctx: RequestContext): string {
  if (!ctx.tenantId) throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Empresa ativa necessária');
  return ctx.tenantId;
}

function requireEditor(ctx: RequestContext): string {
  const id = tenantId(ctx);
  if (!ctx.userId || (ctx.role !== 'owner' && ctx.role !== 'admin')) {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Apenas owner/admin pode editar este contexto');
  }
  return id;
}

function lexicalScore(text: string, query: string): number {
  const words = query.toLocaleLowerCase('pt-BR').match(/[\p{L}]{4,}/gu) ?? [];
  if (!words.length) return 0;
  const haystack = text.toLocaleLowerCase('pt-BR');
  return new Set(words).size === 0 ? 0 : [...new Set(words)].filter((word) => haystack.includes(word)).length / new Set(words).size;
}

function visibleSummary(item: { curatedText: string | null; text: string }): string {
  return [item.curatedText, item.text].filter(Boolean).join('\n');
}

/** Tenant-scoped official profile and reviewable summaries of past conversations. */
export class CompanyKnowledgeService {
  constructor(
    private readonly db: PrismaClient,
    private readonly llm: LLMAdapter | null,
    private readonly embedder: Embedder | null,
  ) {}

  async profile(ctx: RequestContext) {
    return this.db.companyAgentProfile.findUnique({ where: { tenantId: tenantId(ctx) } });
  }

  async saveProfile(ctx: RequestContext, raw: unknown) {
    const id = requireEditor(ctx);
    const data = profileInput.parse(raw);
    return this.db.companyAgentProfile.upsert({
      where: { tenantId: id },
      create: { tenantId: id, ...data, updatedBy: ctx.userId },
      update: { ...data, updatedBy: ctx.userId },
    });
  }

  async suggestProfile(ctx: RequestContext) {
    const id = requireEditor(ctx);
    if (!this.llm) return { suggestions: {} };
    const [memories, facts] = await Promise.all([
      this.db.conversationSummary.findMany({
        where: { tenantId: id, deletedAt: null, OR: [{ text: { not: '' } }, { curatedText: { not: null } }] }, orderBy: { updatedAt: 'desc' }, take: 30,
        select: { text: true, curatedText: true },
      }),
      this.db.businessFact.findMany({
        where: { tenantId: id, OR: [{ validTo: null }, { validTo: { gte: new Date() } }] },
        orderBy: { createdAt: 'desc' }, take: 30, select: { text: true },
      }),
    ]);
    if (!memories.length && !facts.length) return { suggestions: {} };
    const response = await this.llm.complete({
      system: 'Extraia apenas complementos explícitos sobre a empresa destes resumos. Responda só JSON com estas chaves opcionais: industry, offering, customers, geography, positioning, priorities. Cada valor deve ser uma frase curta, factual, sem inventar detalhes. O perfil oficial só será alterado após revisão humana.',
      messages: [{ role: 'user', content: [
        'Resumos de conversas:', ...memories.map(visibleSummary),
        'Fatos registrados:', ...facts.map((fact) => fact.text),
      ].join('\n').slice(0, 18000) }],
      tools: [], maxOutputTokens: 450,
    });
    try {
      const raw = JSON.parse(response.text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as unknown;
      return { suggestions: profileInput.partial().parse(raw) };
    } catch {
      return { suggestions: {} };
    }
  }

  async currentUser(ctx: RequestContext) {
    if (!ctx.userId) return null;
    const user = await this.db.user.findFirst({
      where: { id: ctx.userId, memberships: { some: { tenantId: tenantId(ctx), status: 'active' } } },
      select: { id: true, name: true },
    });
    return user ? { ...user, role: ctx.role } : null;
  }

  async listSummaries(ctx: RequestContext) {
    const rows = await this.db.conversationSummary.findMany({
      where: { tenantId: tenantId(ctx), deletedAt: null, OR: [{ text: { not: '' } }, { curatedText: { not: null } }] },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: { id: true, text: true, curatedText: true, authorUserId: true, updatedAt: true, reviewedAt: true, conversationId: true },
    });
    return rows.map((row) => ({ ...row, text: visibleSummary(row) }));
  }

  async editSummary(ctx: RequestContext, id: string, raw: unknown) {
    const companyId = requireEditor(ctx);
    z.string().uuid().parse(id);
    const { text } = summaryInput.parse(raw);
    const existing = await this.db.conversationSummary.findFirst({ where: { id, tenantId: companyId, deletedAt: null } });
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'Memória não encontrada');
    const updated = await this.db.conversationSummary.update({
      where: { id }, data: { text: '', curatedText: text, reviewedAt: new Date(), editedBy: ctx.userId, embeddedAt: null },
    });
    await this.db.$executeRaw`
      UPDATE conversation_summaries SET embedding = NULL
      WHERE id = ${id}::uuid AND tenant_id = ${companyId}::uuid
    `;
    await this.updateEmbedding(companyId, id, text);
    return { ...updated, text: visibleSummary(updated) };
  }

  async deleteSummary(ctx: RequestContext, id: string) {
    const companyId = requireEditor(ctx);
    z.string().uuid().parse(id);
    const count = await this.db.$executeRaw`
      UPDATE conversation_summaries
      SET deleted_at = CURRENT_TIMESTAMP, text = '', curated_text = NULL, embedding = NULL, embedded_at = NULL
      WHERE id = ${id}::uuid AND tenant_id = ${companyId}::uuid AND deleted_at IS NULL
    `;
    if (!count) throw new AppError(ErrorCode.NOT_FOUND, 'Memória não encontrada');
    return { deleted: true };
  }

  async search(ctx: RequestContext, query: string, limit = 5) {
    const companyId = tenantId(ctx);
    const candidates = await this.db.conversationSummary.findMany({
      where: { tenantId: companyId, deletedAt: null, OR: [{ text: { not: '' } }, { curatedText: { not: null } }] },
      orderBy: { updatedAt: 'desc' },
      take: 150,
      select: { id: true, text: true, curatedText: true, authorUserId: true, conversationId: true, updatedAt: true, reviewedAt: true },
    });
    if (!candidates.length) return [];
    const authors = await this.db.user.findMany({
      where: { id: { in: [...new Set(candidates.map((item) => item.authorUserId))] } },
      select: { id: true, name: true },
    });
    const authorNames = new Map(authors.map((author) => [author.id, author.name]));
    let semantic = new Map<string, number>();
    if (this.embedder && query.trim()) {
      try {
        const [embedding] = await this.embedder.embed([query]);
        if (embedding) {
          const vector = toVectorLiteral(embedding);
          const rows = await this.db.$queryRaw<Array<{ id: string; score: number }>>`
            SELECT id, (1 - (embedding <=> ${vector}::vector))::float8 AS score
            FROM conversation_summaries
            WHERE tenant_id = ${companyId}::uuid AND embedding IS NOT NULL AND deleted_at IS NULL
            ORDER BY embedding <=> ${vector}::vector LIMIT ${Math.min(limit * 4, 30)}
          `;
          semantic = new Map(rows.map((row) => [row.id, row.score]));
        }
      } catch (error) {
        logger.warn({ tenant_id: companyId, err: error }, 'conversation summary semantic search failed');
      }
    }
    return candidates
      .map((item) => ({
        ...item,
        text: visibleSummary(item),
        relevance: Math.max(semantic.get(item.id) ?? 0, lexicalScore(visibleSummary(item), query)),
        personal: item.authorUserId === ctx.userId,
        authorName: authorNames.get(item.authorUserId) ?? 'Membro da empresa',
      }))
      .filter((item) => item.relevance >= 0.2 || item.personal)
      .sort((a, b) => (b.relevance + (b.personal ? 0.08 : 0)) - (a.relevance + (a.personal ? 0.08 : 0)))
      .slice(0, limit);
  }

  /** Idempotent incremental summary, called after the assistant response is saved. */
  async summarizeConversation(ctx: RequestContext, conversationId: string) {
    const companyId = tenantId(ctx);
    if (!this.llm) return;
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, tenantId: companyId } });
    if (!conversation) return;
    const previous = await this.db.conversationSummary.findUnique({ where: { conversationId } });
    if (previous?.deletedAt) return;
    const recent = await this.db.message.findMany({
      where: { tenantId: companyId, conversationId, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, role: true, content: true },
    });
    const latest = recent[0];
    if (!latest || latest.id === previous?.lastMessageId) return;
    const ordered = recent.reverse();
    const lastIndex = previous?.lastMessageId ? ordered.findIndex((item) => item.id === previous.lastMessageId) : -1;
    const unseen = ordered.slice(lastIndex + 1);
    const transcript = unseen.map((item) => `${item.role}: ${item.content.slice(0, 1200)}`).join('\n').slice(-18000);
    try {
      const answer = await this.llm.complete({
        system: 'Resuma para memória compartilhada da empresa apenas fatos do negócio, decisões, prioridades e preferências de trabalho ou comunicação explicitamente informados pelos usuários. Use respostas do assistente só para entender a conversa; não transforme análises, números, pesquisa externa ou hipóteses dele em fatos. Preserve datas e incerteza. Não inclua dados pessoais sem relevância de negócio. Até 900 caracteres. Se nada duradouro foi informado, responda exatamente SEM_MEMORIA.',
        messages: [{ role: 'user', content: `Memória anterior: ${previous?.text ?? 'nenhuma'}\n\nConversa recente:\n${transcript}` }],
        tools: [], maxOutputTokens: 400,
      });
      const raw = answer.text.trim().slice(0, 3000);
      const text = raw === 'SEM_MEMORIA' ? (previous?.text ?? '') : raw;
      if (!raw) return;
      const record = await this.db.conversationSummary.upsert({
        where: { conversationId },
        create: { id: createId(), tenantId: companyId, conversationId, authorUserId: conversation.userId, text, lastMessageId: latest.id },
        update: { text, lastMessageId: latest.id, embeddedAt: null },
      });
      await this.db.$executeRaw`
        UPDATE conversation_summaries SET embedding = NULL
        WHERE id = ${record.id}::uuid AND tenant_id = ${companyId}::uuid
      `;
      const combined = visibleSummary(record);
      if (combined) await this.updateEmbedding(companyId, record.id, combined);
    } catch (error) {
      logger.warn({ tenant_id: companyId, conversation_id: conversationId, err: error }, 'conversation summary failed');
    }
  }

  async backfill(ctx: RequestContext, take = 100) {
    const companyId = tenantId(ctx);
    const rows = await this.db.conversation.findMany({
      where: { tenantId: companyId, summary: null },
      orderBy: { updatedAt: 'desc' }, take,
      select: { id: true },
    });
    for (const row of rows) await this.summarizeConversation(ctx, row.id);
    return { processed: rows.length };
  }

  private async updateEmbedding(companyId: string, id: string, text: string) {
    if (!this.embedder) return;
    try {
      const [embedding] = await this.embedder.embed([text]);
      if (!embedding) return;
      const vector = toVectorLiteral(embedding);
      await this.db.$executeRaw`
        UPDATE conversation_summaries SET embedding = ${vector}::vector, embedded_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND tenant_id = ${companyId}::uuid
      `;
    } catch (error) {
      logger.warn({ tenant_id: companyId, summary_id: id, err: error }, 'conversation summary embedding failed');
    }
  }
}
