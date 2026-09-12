-- AlterTable
ALTER TABLE "business_facts" ADD COLUMN "embedded_at" TIMESTAMP(3),
ADD COLUMN "embedding" vector(1536);

-- CreateIndex
CREATE INDEX "business_facts_embedding_hnsw_idx" ON "business_facts" USING hnsw ("embedding" vector_cosine_ops);

-- CreateEnum
CREATE TYPE "EpisodeKind" AS ENUM ('decision', 'action_outcome', 'event');

-- CreateEnum
CREATE TYPE "EpisodeOutcome" AS ENUM ('approved', 'rejected', 'executed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "episodes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "EpisodeKind" NOT NULL,
    "outcome" "EpisodeOutcome" NOT NULL,
    "text" TEXT NOT NULL,
    "action_execution_id" UUID,
    "approval_id" UUID,
    "entity_type" TEXT,
    "entity_id" UUID,
    "embedding" vector(1536),
    "embedded_at" TIMESTAMP(3),
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playbooks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "embedding" vector(1536),
    "embedded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playbooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "episodes_tenant_id_action_execution_id_outcome_key" ON "episodes"("tenant_id", "action_execution_id", "outcome");

-- CreateIndex
CREATE INDEX "episodes_tenant_id_occurred_at_idx" ON "episodes"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "episodes_tenant_id_kind_idx" ON "episodes"("tenant_id", "kind");

-- CreateIndex
CREATE INDEX "episodes_tenant_id_action_execution_id_idx" ON "episodes"("tenant_id", "action_execution_id");

-- CreateIndex
CREATE INDEX "episodes_embedding_hnsw_idx" ON "episodes" USING hnsw ("embedding" vector_cosine_ops);

-- CreateIndex
CREATE UNIQUE INDEX "playbooks_tenant_id_slug_key" ON "playbooks"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "playbooks_tenant_id_enabled_idx" ON "playbooks"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "playbooks_embedding_hnsw_idx" ON "playbooks" USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_action_execution_id_fkey" FOREIGN KEY ("action_execution_id") REFERENCES "action_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
