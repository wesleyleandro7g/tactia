ALTER TYPE "DataSourceStatus" ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE "DataSourceStatus" ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE "DataSourceStatus" ADD VALUE IF NOT EXISTS 'needs_attention';
ALTER TYPE "SyncJobStatus" ADD VALUE IF NOT EXISTS 'partial';
ALTER TYPE "SyncJobStatus" ADD VALUE IF NOT EXISTS 'needs_attention';

CREATE TYPE "IntegrationModuleRunStatus" AS ENUM (
  'queued', 'running', 'succeeded', 'failed', 'cancelled', 'needs_attention'
);

ALTER TABLE "sync_jobs" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "sync_jobs_idempotency_key_key" ON "sync_jobs"("idempotency_key");
CREATE UNIQUE INDEX "sync_jobs_one_active_per_source_idx"
  ON "sync_jobs"("data_source_id")
  WHERE "status" IN ('pending', 'running');

CREATE TABLE "integration_module_runs" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "data_source_id" UUID NOT NULL,
  "sync_job_id" UUID NOT NULL,
  "module_key" TEXT NOT NULL,
  "status" "IntegrationModuleRunStatus" NOT NULL DEFAULT 'queued',
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "next_attempt_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "external_execution_id" TEXT,
  "workflow_key" TEXT NOT NULL,
  "workflow_version" TEXT NOT NULL,
  "parser_version" TEXT NOT NULL,
  "records_read" INTEGER NOT NULL DEFAULT 0,
  "records_failed" INTEGER NOT NULL DEFAULT 0,
  "checkpoint" JSONB,
  "evidence" JSONB,
  "error_code" TEXT,
  "safe_message" TEXT,
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_module_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_module_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "integration_module_runs_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "integration_module_runs_sync_job_id_fkey" FOREIGN KEY ("sync_job_id") REFERENCES "sync_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "integration_module_runs_sync_job_id_module_key_key" ON "integration_module_runs"("sync_job_id", "module_key");
CREATE INDEX "integration_module_runs_tenant_id_data_source_id_status_idx" ON "integration_module_runs"("tenant_id", "data_source_id", "status");
CREATE INDEX "integration_module_runs_lease_expires_at_idx" ON "integration_module_runs"("lease_expires_at");

CREATE TABLE "integration_artifacts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "data_source_id" UUID NOT NULL,
  "module_run_id" UUID NOT NULL,
  "origin" TEXT NOT NULL,
  "module_key" TEXT NOT NULL,
  "period_from" TIMESTAMP(3),
  "period_to" TIMESTAMP(3),
  "checksum" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "retention_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "integration_artifacts_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "integration_artifacts_module_run_id_fkey" FOREIGN KEY ("module_run_id") REFERENCES "integration_module_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "integration_artifacts_tenant_id_checksum_module_key_key" ON "integration_artifacts"("tenant_id", "checksum", "module_key");
CREATE INDEX "integration_artifacts_tenant_id_data_source_id_created_at_idx" ON "integration_artifacts"("tenant_id", "data_source_id", "created_at");
CREATE INDEX "integration_artifacts_retention_until_idx" ON "integration_artifacts"("retention_until");

CREATE TABLE "browser_workflow_bindings" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "engine" TEXT NOT NULL,
  "workflow_key" TEXT NOT NULL,
  "workflow_version" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "instance_key" TEXT NOT NULL,
  "external_task_id" TEXT NOT NULL,
  "definition_checksum" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "browser_workflow_bindings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "browser_workflow_bindings_identity_key" ON "browser_workflow_bindings"("provider", "engine", "workflow_key", "workflow_version", "environment", "instance_key");
CREATE INDEX "browser_workflow_bindings_provider_environment_active_idx" ON "browser_workflow_bindings"("provider", "environment", "active");
