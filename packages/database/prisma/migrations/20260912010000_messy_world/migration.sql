-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentKind" AS ENUM ('policy', 'playbook_doc', 'contract', 'other');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "MediaAssetPurpose" AS ENUM ('knowledge', 'interaction', 'auto');

-- AlterEnum
ALTER TYPE "DataSourceType" ADD VALUE 'document';
ALTER TYPE "DataSourceType" ADD VALUE 'image';
ALTER TYPE "DataSourceType" ADD VALUE 'audio';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "embedding" vector(1536),
ADD COLUMN "embedded_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "products" ADD COLUMN "embedding" vector(1536),
ADD COLUMN "embedded_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "KnowledgeDocumentKind" NOT NULL DEFAULT 'other',
    "mime" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "heading" TEXT,
    "page" INTEGER,
    "text" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "embedding" vector(1536),
    "embedded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purpose" "MediaAssetPurpose" NOT NULL DEFAULT 'auto',
    "mime" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "classification" TEXT,
    "result_kind" TEXT,
    "result_id" UUID,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_id_status_idx" ON "knowledge_documents"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_id_created_at_idx" ON "knowledge_documents"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_tenant_id_checksum_key" ON "knowledge_documents"("tenant_id", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_ordinal_key" ON "document_chunks"("document_id", "ordinal");

-- CreateIndex
CREATE INDEX "document_chunks_tenant_id_document_id_idx" ON "document_chunks"("tenant_id", "document_id");

-- CreateIndex
CREATE INDEX "document_chunks_embedding_hnsw_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- CreateIndex
CREATE INDEX "media_assets_tenant_id_status_idx" ON "media_assets"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "media_assets_tenant_id_created_at_idx" ON "media_assets"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "customers_embedding_hnsw_idx" ON "customers" USING hnsw ("embedding" vector_cosine_ops);

-- CreateIndex
CREATE INDEX "products_embedding_hnsw_idx" ON "products" USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
