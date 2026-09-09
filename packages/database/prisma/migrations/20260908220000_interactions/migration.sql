-- CreateExtension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "InteractionChannel" AS ENUM ('whatsapp', 'email', 'note', 'other');

-- CreateEnum
CREATE TYPE "InteractionDirection" AS ENUM ('inbound', 'outbound', 'internal');

-- CreateEnum
CREATE TYPE "InteractionIntent" AS ENUM ('complaint', 'praise', 'question', 'other');

-- CreateTable
CREATE TABLE "interactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data_source_id" UUID,
    "external_id" TEXT,
    "customer_id" UUID,
    "channel" "InteractionChannel" NOT NULL,
    "direction" "InteractionDirection" NOT NULL DEFAULT 'inbound',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "intent" "InteractionIntent",
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "embedding" vector(1536),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "interactions_tenant_id_data_source_id_external_id_key" ON "interactions"("tenant_id", "data_source_id", "external_id");

-- CreateIndex
CREATE INDEX "interactions_tenant_id_occurred_at_idx" ON "interactions"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "interactions_tenant_id_customer_id_idx" ON "interactions"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "interactions_tenant_id_intent_occurred_at_idx" ON "interactions"("tenant_id", "intent", "occurred_at");

-- CreateIndex
CREATE INDEX "interactions_tenant_id_channel_idx" ON "interactions"("tenant_id", "channel");

-- CreateIndex
CREATE INDEX "interactions_tenant_id_data_source_id_idx" ON "interactions"("tenant_id", "data_source_id");

-- CreateIndex
CREATE INDEX "interactions_embedding_hnsw_idx" ON "interactions" USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
