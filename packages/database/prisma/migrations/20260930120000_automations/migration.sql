-- Automações personalizadas por cliente.

ALTER TABLE "tenants" ADD COLUMN "automations_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "AutomationStatus" AS ENUM ('draft', 'published', 'paused');
CREATE TYPE "AutomationRunStatus" AS ENUM ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'needs_attention');
CREATE TYPE "AutomationStepStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'skipped', 'awaiting_approval', 'cancelled', 'needs_attention');
CREATE TYPE "AutomationOrigin" AS ENUM ('page', 'agent', 'schedule', 'webhook', 'internal_event');
CREATE TYPE "AutomationTriggerKind" AS ENUM ('webhook', 'internal_event');
CREATE TYPE "AutomationOutboxStatus" AS ENUM ('pending', 'dispatching', 'dispatched');

CREATE TABLE "automations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'draft',
    "published_version_id" UUID,
    "component_key" TEXT,
    "parameter_defaults" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "input_schema" JSONB NOT NULL,
    "output_schema" JSONB NOT NULL DEFAULT '{}',
    "steps" JSONB NOT NULL,
    "page_config" JSONB NOT NULL,
    "authorization_policy" JSONB NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "automation_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'queued',
    "origin" "AutomationOrigin" NOT NULL,
    "origin_ref" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "summary" TEXT,
    "error" TEXT,
    "requested_by" UUID,
    "schedule_occurrence_id" UUID,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "force_approval" BOOLEAN NOT NULL DEFAULT false,
    "lease_owner" TEXT,
    "lease_until" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_step_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_key" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" "AutomationStepStatus" NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "action_execution_id" UUID,
    "approval_id" UUID,
    "external_execution_id" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "automation_step_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_triggers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "kind" "AutomationTriggerKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "secret_cipher" TEXT,
    "event_type" TEXT,
    "connection_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "automation_triggers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_artifacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_run_id" UUID,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "automation_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_outbox" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "status" "AutomationOutboxStatus" NOT NULL DEFAULT 'pending',
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "automation_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_connection_locks" (
    "connection_id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "automation_connection_locks_pkey" PRIMARY KEY ("connection_id")
);

CREATE TABLE "domain_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "dispatched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automations_published_version_id_key" ON "automations"("published_version_id");
CREATE UNIQUE INDEX "automations_tenant_id_key_key" ON "automations"("tenant_id", "key");
CREATE INDEX "automations_tenant_id_status_idx" ON "automations"("tenant_id", "status");

CREATE UNIQUE INDEX "automation_versions_automation_id_version_key" ON "automation_versions"("automation_id", "version");
CREATE INDEX "automation_versions_tenant_id_idx" ON "automation_versions"("tenant_id");

CREATE UNIQUE INDEX "automation_runs_tenant_id_automation_id_idempotency_key_key" ON "automation_runs"("tenant_id", "automation_id", "idempotency_key");
CREATE INDEX "automation_runs_tenant_id_status_idx" ON "automation_runs"("tenant_id", "status");
CREATE INDEX "automation_runs_tenant_id_automation_id_created_at_idx" ON "automation_runs"("tenant_id", "automation_id", "created_at");

CREATE UNIQUE INDEX "automation_step_runs_run_id_step_key_key" ON "automation_step_runs"("run_id", "step_key");
CREATE INDEX "automation_step_runs_tenant_id_status_idx" ON "automation_step_runs"("tenant_id", "status");
CREATE INDEX "automation_step_runs_action_execution_id_idx" ON "automation_step_runs"("action_execution_id");

CREATE INDEX "automation_triggers_tenant_id_automation_id_idx" ON "automation_triggers"("tenant_id", "automation_id");
CREATE INDEX "automation_triggers_kind_event_type_enabled_idx" ON "automation_triggers"("kind", "event_type", "enabled");

CREATE INDEX "automation_artifacts_tenant_id_run_id_idx" ON "automation_artifacts"("tenant_id", "run_id");
CREATE INDEX "automation_outbox_status_available_at_idx" ON "automation_outbox"("status", "available_at");
CREATE INDEX "automation_outbox_run_id_idx" ON "automation_outbox"("run_id");
CREATE INDEX "automation_connection_locks_run_id_idx" ON "automation_connection_locks"("run_id");

CREATE UNIQUE INDEX "domain_events_tenant_id_type_source_id_key" ON "domain_events"("tenant_id", "type", "source_id");
CREATE INDEX "domain_events_dispatched_at_created_at_idx" ON "domain_events"("dispatched_at", "created_at");

ALTER TABLE "automations" ADD CONSTRAINT "automations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automations" ADD CONSTRAINT "automations_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "automation_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "automation_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automation_step_runs" ADD CONSTRAINT "automation_step_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_step_runs" ADD CONSTRAINT "automation_step_runs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_triggers" ADD CONSTRAINT "automation_triggers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_triggers" ADD CONSTRAINT "automation_triggers_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_artifacts" ADD CONSTRAINT "automation_artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_artifacts" ADD CONSTRAINT "automation_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_outbox" ADD CONSTRAINT "automation_outbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_outbox" ADD CONSTRAINT "automation_outbox_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_connection_locks" ADD CONSTRAINT "automation_connection_locks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schedules" ADD COLUMN "automation_id" UUID;
ALTER TABLE "schedules" ADD COLUMN "automation_params" JSONB;
ALTER TABLE "schedule_occurrences" ADD COLUMN "automation_run_id" UUID;
