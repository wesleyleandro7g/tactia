import { createId } from '@tactia/shared';
import {
  Prisma,
  type KnowledgeDocumentKind,
  type KnowledgeDocumentStatus,
  type PrismaClient,
} from '../client';
import { toVectorLiteral } from '../embeddings';

export type CreateKnowledgeDocumentInput = {
  id?: string;
  tenantId: string;
  title: string;
  kind?: KnowledgeDocumentKind;
  mime: string;
  storageKey: string;
  checksum: string;
  byteSize: number;
  uploadedBy?: string | null;
  status?: KnowledgeDocumentStatus;
  error?: string | null;
};

export type KnowledgeDocumentRecord = {
  id: string;
  tenantId: string;
  title: string;
  kind: KnowledgeDocumentKind;
  mime: string;
  storageKey: string;
  checksum: string;
  byteSize: number;
  status: KnowledgeDocumentStatus;
  error: string | null;
  uploadedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentChunkRecord = {
  id: string;
  tenantId: string;
  documentId: string;
  ordinal: number;
  heading: string | null;
  page: number | null;
  text: string;
  tokenCount: number;
  embeddedAt: Date | null;
  createdAt: Date;
};

export type DocumentChunkSearchHit = DocumentChunkRecord & {
  score: number;
  documentTitle: string;
};

const documentSelect = {
  id: true,
  tenantId: true,
  title: true,
  kind: true,
  mime: true,
  storageKey: true,
  checksum: true,
  byteSize: true,
  status: true,
  error: true,
  uploadedBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.KnowledgeDocumentSelect;

const chunkSelect = {
  id: true,
  tenantId: true,
  documentId: true,
  ordinal: true,
  heading: true,
  page: true,
  text: true,
  tokenCount: true,
  embeddedAt: true,
  createdAt: true,
} satisfies Prisma.DocumentChunkSelect;

export class KnowledgeDocumentRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateKnowledgeDocumentInput): Promise<KnowledgeDocumentRecord> {
    return this.db.knowledgeDocument.create({
      data: {
        id: input.id ?? createId(),
        tenantId: input.tenantId,
        title: input.title,
        kind: input.kind ?? 'other',
        mime: input.mime,
        storageKey: input.storageKey,
        checksum: input.checksum,
        byteSize: input.byteSize,
        uploadedBy: input.uploadedBy ?? null,
        status: input.status ?? 'pending',
        error: input.error ?? null,
      },
      select: documentSelect,
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.knowledgeDocument.findFirst({
      where: { id, tenantId },
      select: documentSelect,
    });
  }

  async findByChecksum({ tenantId, checksum }: { tenantId: string; checksum: string }) {
    return this.db.knowledgeDocument.findFirst({
      where: { tenantId, checksum },
      select: documentSelect,
    });
  }

  async list({
    tenantId,
    skip,
    take,
    status,
  }: {
    tenantId: string;
    skip: number;
    take: number;
    status?: KnowledgeDocumentStatus;
  }) {
    const where: Prisma.KnowledgeDocumentWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.knowledgeDocument.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: documentSelect,
      }),
      this.db.knowledgeDocument.count({ where }),
    ]);
    return { items, total };
  }

  async updateStatus({
    tenantId,
    id,
    status,
    error,
  }: {
    tenantId: string;
    id: string;
    status: KnowledgeDocumentStatus;
    error?: string | null;
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.knowledgeDocument.update({
      where: { id },
      data: { status, error: error === undefined ? existing.error : error },
      select: documentSelect,
    });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.knowledgeDocument.delete({ where: { id } });
    return existing;
  }

  async deleteChunks(documentId: string) {
    await this.db.documentChunk.deleteMany({ where: { documentId } });
  }

  async createChunks(
    chunks: Array<{
      tenantId: string;
      documentId: string;
      ordinal: number;
      heading: string | null;
      page?: number | null;
      text: string;
      tokenCount: number;
    }>,
  ): Promise<DocumentChunkRecord[]> {
    const created: DocumentChunkRecord[] = [];
    for (const chunk of chunks) {
      const row = await this.db.documentChunk.create({
        data: {
          id: createId(),
          tenantId: chunk.tenantId,
          documentId: chunk.documentId,
          ordinal: chunk.ordinal,
          heading: chunk.heading,
          page: chunk.page ?? null,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
        },
        select: chunkSelect,
      });
      created.push(row);
    }
    return created;
  }

  async listChunks(documentId: string): Promise<DocumentChunkRecord[]> {
    return this.db.documentChunk.findMany({
      where: { documentId },
      orderBy: { ordinal: 'asc' },
      select: chunkSelect,
    });
  }

  async updateChunkEmbedding({
    tenantId,
    id,
    embedding,
  }: {
    tenantId: string;
    id: string;
    embedding: number[];
  }): Promise<void> {
    const vector = toVectorLiteral(embedding);
    await this.db.$executeRaw`
      UPDATE document_chunks
      SET embedding = ${vector}::vector, embedded_at = CURRENT_TIMESTAMP
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `;
  }

  async searchByEmbedding({
    tenantId,
    embedding,
    limit = 8,
  }: {
    tenantId: string;
    embedding: number[];
    limit?: number;
  }): Promise<DocumentChunkSearchHit[]> {
    const vector = toVectorLiteral(embedding);
    return this.db.$queryRaw<DocumentChunkSearchHit[]>`
      SELECT
        c.id,
        c.tenant_id AS "tenantId",
        c.document_id AS "documentId",
        c.ordinal,
        c.heading,
        c.page,
        c.text,
        c.token_count AS "tokenCount",
        c.embedded_at AS "embeddedAt",
        c.created_at AS "createdAt",
        d.title AS "documentTitle",
        (1 - (c.embedding <=> ${vector}::vector))::float8 AS score
      FROM document_chunks c
      INNER JOIN knowledge_documents d ON d.id = c.document_id
      WHERE c.tenant_id = ${tenantId}::uuid
        AND c.embedding IS NOT NULL
        AND d.status = 'ready'
      ORDER BY c.embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;
  }

  async searchByKeyword({
    tenantId,
    query,
    limit = 8,
  }: {
    tenantId: string;
    query: string;
    limit?: number;
  }): Promise<Array<DocumentChunkRecord & { documentTitle: string }>> {
    return this.db.documentChunk.findMany({
      where: {
        tenantId,
        text: { contains: query, mode: 'insensitive' },
        document: { status: 'ready' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        ...chunkSelect,
        document: { select: { title: true } },
      },
    }).then((rows) =>
      rows.map((row) => {
        const { document, ...chunk } = row;
        return { ...chunk, documentTitle: document.title };
      }),
    );
  }
}
