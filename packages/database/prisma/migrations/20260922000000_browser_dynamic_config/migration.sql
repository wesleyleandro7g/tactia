-- Immutable snapshot captured when a SyncJob is created (instance, credential
-- references and resolved task IDs). Used verbatim on retries. Never contains
-- secrets.
ALTER TABLE "sync_jobs" ADD COLUMN "config_snapshot" JSONB;

-- Tenant-scoped browser executor instances (DB-first, env is fallback only).
CREATE TABLE "browser_executor_instances" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "engine" TEXT NOT NULL,
  "instance_key" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "dedicated_connection_id" UUID,
  "api_key_credential_id" UUID NOT NULL,
  "environment" TEXT NOT NULL,
  "allow_insecure_http" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "browser_executor_instances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "browser_executor_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "browser_executor_instances_api_key_credential_id_fkey" FOREIGN KEY ("api_key_credential_id") REFERENCES "credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "browser_executor_instances_identity_key" ON "browser_executor_instances"("tenant_id", "provider", "engine", "instance_key", "environment");
CREATE INDEX "browser_executor_instances_tenant_provider_env_active_idx" ON "browser_executor_instances"("tenant_id", "provider", "environment", "active");

-- Logical workflow (stable identity), pointing at its active revision.
CREATE TABLE "browser_workflows" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "engine" TEXT NOT NULL,
  "workflow_key" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "active_revision_id" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "browser_workflows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "browser_workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "browser_workflows_identity_key" ON "browser_workflows"("tenant_id", "provider", "engine", "workflow_key", "environment");
CREATE UNIQUE INDEX "browser_workflows_active_revision_id_key" ON "browser_workflows"("active_revision_id");
CREATE INDEX "browser_workflows_tenant_provider_env_active_idx" ON "browser_workflows"("tenant_id", "provider", "environment", "active");

-- Immutable, append-only revisions of a workflow definition.
CREATE TABLE "browser_workflow_revisions" (
  "id" UUID NOT NULL,
  "workflow_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "workflow_version" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "definition_checksum" TEXT NOT NULL,
  "publishable" BOOLEAN NOT NULL DEFAULT false,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "browser_workflow_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "browser_workflow_revisions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "browser_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "browser_workflow_revisions_workflow_id_revision_key" ON "browser_workflow_revisions"("workflow_id", "revision");
CREATE INDEX "browser_workflow_revisions_workflow_id_idx" ON "browser_workflow_revisions"("workflow_id");
CREATE INDEX "browser_workflow_revisions_tenant_id_idx" ON "browser_workflow_revisions"("tenant_id");

-- Deferred FK: workflow.active_revision_id -> revision.id
ALTER TABLE "browser_workflows"
  ADD CONSTRAINT "browser_workflows_active_revision_id_fkey"
  FOREIGN KEY ("active_revision_id") REFERENCES "browser_workflow_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Evolve BrowserWorkflowBinding additively.
ALTER TABLE "browser_workflow_bindings" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "browser_workflow_bindings" ADD COLUMN "reconciliation_marker" TEXT;
ALTER TABLE "browser_workflow_bindings" ADD COLUMN "browser_executor_instance_id" UUID;
ALTER TABLE "browser_workflow_bindings" ADD COLUMN "workflow_revision_id" UUID;
ALTER TABLE "browser_workflow_bindings"
  ADD CONSTRAINT "browser_workflow_bindings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "browser_workflow_bindings"
  ADD CONSTRAINT "browser_workflow_bindings_browser_executor_instance_id_fkey"
  FOREIGN KEY ("browser_executor_instance_id") REFERENCES "browser_executor_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "browser_workflow_bindings"
  ADD CONSTRAINT "browser_workflow_bindings_workflow_revision_id_fkey"
  FOREIGN KEY ("workflow_revision_id") REFERENCES "browser_workflow_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "browser_workflow_bindings_tenant_id_idx" ON "browser_workflow_bindings"("tenant_id");
CREATE INDEX "browser_workflow_bindings_browser_executor_instance_id_idx" ON "browser_workflow_bindings"("browser_executor_instance_id");
CREATE INDEX "browser_workflow_bindings_workflow_revision_id_idx" ON "browser_workflow_bindings"("workflow_revision_id");
