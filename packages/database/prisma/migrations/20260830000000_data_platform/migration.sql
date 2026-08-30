-- CreateEnum
CREATE TYPE "DataSourceType" AS ENUM ('csv', 'xlsx', 'postgres', 'rest', 'google_sheets');

-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('active', 'inactive', 'error');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "encrypted_data" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "DataSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'active',
    "configuration" JSONB,
    "credential_id" UUID,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data_source_id" UUID NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "records_read" INTEGER NOT NULL DEFAULT 0,
    "records_created" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data_source_id" UUID NOT NULL,
    "sync_job_id" UUID,
    "external_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mappings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data_source_id" UUID NOT NULL,
    "source_entity" TEXT NOT NULL,
    "target_entity" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data_source_id" UUID NOT NULL,
    "sync_job_id" UUID,
    "entity_type" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "processed_records" INTEGER NOT NULL DEFAULT 0,
    "failed_records" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_quality_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data_source_id" UUID NOT NULL,
    "sync_job_id" UUID,
    "entity_type" TEXT NOT NULL,
    "total_records" INTEGER NOT NULL,
    "valid_records" INTEGER NOT NULL,
    "invalid_records" INTEGER NOT NULL,
    "warnings" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credentials_tenant_id_idx" ON "credentials"("tenant_id");

-- CreateIndex
CREATE INDEX "data_sources_tenant_id_idx" ON "data_sources"("tenant_id");

-- CreateIndex
CREATE INDEX "data_sources_tenant_id_status_idx" ON "data_sources"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "data_sources_tenant_id_created_at_idx" ON "data_sources"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "sync_jobs_tenant_id_status_idx" ON "sync_jobs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sync_jobs_tenant_id_data_source_id_idx" ON "sync_jobs"("tenant_id", "data_source_id");

-- CreateIndex
CREATE INDEX "sync_jobs_tenant_id_created_at_idx" ON "sync_jobs"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "raw_records_tenant_id_data_source_id_external_id_entity_type_key" ON "raw_records"("tenant_id", "data_source_id", "external_id", "entity_type");

-- CreateIndex
CREATE INDEX "raw_records_tenant_id_data_source_id_idx" ON "raw_records"("tenant_id", "data_source_id");

-- CreateIndex
CREATE INDEX "raw_records_tenant_id_entity_type_idx" ON "raw_records"("tenant_id", "entity_type");

-- CreateIndex
CREATE INDEX "raw_records_tenant_id_external_id_idx" ON "raw_records"("tenant_id", "external_id");

-- CreateIndex
CREATE INDEX "mappings_tenant_id_data_source_id_idx" ON "mappings"("tenant_id", "data_source_id");

-- CreateIndex
CREATE INDEX "mappings_tenant_id_target_entity_idx" ON "mappings"("tenant_id", "target_entity");

-- CreateIndex
CREATE UNIQUE INDEX "imports_idempotency_key_key" ON "imports"("idempotency_key");

-- CreateIndex
CREATE INDEX "imports_tenant_id_status_idx" ON "imports"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "imports_tenant_id_data_source_id_idx" ON "imports"("tenant_id", "data_source_id");

-- CreateIndex
CREATE INDEX "imports_tenant_id_created_at_idx" ON "imports"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "data_quality_reports_tenant_id_data_source_id_idx" ON "data_quality_reports"("tenant_id", "data_source_id");

-- CreateIndex
CREATE INDEX "data_quality_reports_tenant_id_created_at_idx" ON "data_quality_reports"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_sync_job_id_fkey" FOREIGN KEY ("sync_job_id") REFERENCES "sync_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_sync_job_id_fkey" FOREIGN KEY ("sync_job_id") REFERENCES "sync_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_reports" ADD CONSTRAINT "data_quality_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_reports" ADD CONSTRAINT "data_quality_reports_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_reports" ADD CONSTRAINT "data_quality_reports_sync_job_id_fkey" FOREIGN KEY ("sync_job_id") REFERENCES "sync_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
