import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient } from '../client';
import { asJson } from '../json';
import { toVectorLiteral } from '../embeddings';

export type CreatePlaybookInput = {
  tenantId: string;
  slug: string;
  title: string;
  trigger: string;
  steps: unknown;
  enabled?: boolean;
};

export type UpdatePlaybookInput = {
  slug?: string;
  title?: string;
  trigger?: string;
  steps?: unknown;
  enabled?: boolean;
};

export type PlaybookRecord = {
  id: string;
  tenantId: string;
  slug: string;
  title: string;
  trigger: string;
  steps: unknown;
  enabled: boolean;
  embeddedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PlaybookSearchHit = PlaybookRecord & { score: number };

const playbookSelect = {
  id: true,
  tenantId: true,
  slug: true,
  title: true,
  trigger: true,
  steps: true,
  enabled: true,
  embeddedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PlaybookSelect;

export class PlaybookRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreatePlaybookInput): Promise<PlaybookRecord> {
    return this.db.playbook.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        slug: input.slug,
        title: input.title,
        trigger: input.trigger,
        steps: asJson(input.steps) as never,
        enabled: input.enabled ?? true,
      },
      select: playbookSelect,
    });
  }

  async update(
    { tenantId, id }: { tenantId: string; id: string },
    input: UpdatePlaybookInput,
  ): Promise<PlaybookRecord> {
    return this.db.playbook.update({
      where: { id, tenantId },
      data: {
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
        ...(input.steps === undefined ? {} : { steps: asJson(input.steps) as never }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      },
      select: playbookSelect,
    });
  }

  async list({
    tenantId,
    enabled,
  }: {
    tenantId: string;
    enabled?: boolean;
  }): Promise<PlaybookRecord[]> {
    return this.db.playbook.findMany({
      where: { tenantId, ...(enabled === undefined ? {} : { enabled }) },
      orderBy: { createdAt: 'desc' },
      select: playbookSelect,
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.playbook.findFirst({
      where: { id, tenantId },
      select: playbookSelect,
    });
  }

  async findBySlug({ tenantId, slug }: { tenantId: string; slug: string }) {
    return this.db.playbook.findFirst({
      where: { tenantId, slug },
      select: playbookSelect,
    });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.playbook.delete({ where: { id } });
    return existing;
  }

  async findPendingEmbedding({
    tenantId,
    take = 32,
  }: {
    tenantId: string;
    take?: number;
  }): Promise<PlaybookRecord[]> {
    return this.db.$queryRaw<PlaybookRecord[]>`
      SELECT
        id,
        tenant_id AS "tenantId",
        slug,
        title,
        trigger,
        steps,
        enabled,
        embedded_at AS "embeddedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM playbooks
      WHERE tenant_id = ${tenantId}::uuid
        AND embedding IS NULL
      ORDER BY created_at DESC
      LIMIT ${take}
    `;
  }

  async updateEmbedding({
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
      UPDATE playbooks
      SET embedding = ${vector}::vector, embedded_at = CURRENT_TIMESTAMP
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `;
  }

  async searchByEmbedding({
    tenantId,
    embedding,
    limit = 3,
    enabled = true,
  }: {
    tenantId: string;
    embedding: number[];
    limit?: number;
    enabled?: boolean;
  }): Promise<PlaybookSearchHit[]> {
    const vector = toVectorLiteral(embedding);
    return this.db.$queryRaw<PlaybookSearchHit[]>`
      SELECT
        id,
        tenant_id AS "tenantId",
        slug,
        title,
        trigger,
        steps,
        enabled,
        embedded_at AS "embeddedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        (1 - (embedding <=> ${vector}::vector))::float8 AS score
      FROM playbooks
      WHERE tenant_id = ${tenantId}::uuid
        AND embedding IS NOT NULL
        ${enabled === undefined ? Prisma.empty : Prisma.sql`AND enabled = ${enabled}`}
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;
  }
}
