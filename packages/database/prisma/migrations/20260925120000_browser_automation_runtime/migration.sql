ALTER TYPE "ActionType" ADD VALUE 'browser_action';

-- CreateTable
CREATE TABLE "browser_automation_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_url" TEXT NOT NULL,
    "allowed_domains" JSONB NOT NULL,
    "credential_id" UUID,
    "encrypted_state" TEXT,
    "last_validated_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "browser_automation_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "browser_automation_tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "conversation_id" UUID,
    "requested_by" UUID,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "step_count" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "safe_error" TEXT,
    "pending_action" JSONB,
    "approval_execution_id" UUID,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "browser_automation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "browser_automation_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "runtime_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTING',
    "current_url" TEXT,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "browser_automation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "browser_automation_artifacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "browser_automation_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "browser_automation_action_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "action_input" JSONB,
    "result" JSONB,
    "url_before" TEXT,
    "url_after" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "browser_automation_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "browser_automation_profiles_tenant_id_credential_id_idx" ON "browser_automation_profiles"("tenant_id", "credential_id");

-- CreateIndex
CREATE UNIQUE INDEX "browser_automation_profiles_tenant_id_name_key" ON "browser_automation_profiles"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "browser_automation_tasks_tenant_id_status_created_at_idx" ON "browser_automation_tasks"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "browser_automation_tasks_tenant_id_conversation_id_idx" ON "browser_automation_tasks"("tenant_id", "conversation_id");

-- CreateIndex
CREATE INDEX "browser_automation_sessions_tenant_id_task_id_idx" ON "browser_automation_sessions"("tenant_id", "task_id");

-- CreateIndex
CREATE INDEX "browser_automation_sessions_status_expires_at_idx" ON "browser_automation_sessions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "browser_automation_artifacts_tenant_id_task_id_idx" ON "browser_automation_artifacts"("tenant_id", "task_id");

-- CreateIndex
CREATE INDEX "browser_automation_action_logs_tenant_id_task_id_created_at_idx" ON "browser_automation_action_logs"("tenant_id", "task_id", "created_at");

-- AddForeignKey
ALTER TABLE "browser_automation_profiles" ADD CONSTRAINT "browser_automation_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_profiles" ADD CONSTRAINT "browser_automation_profiles_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_tasks" ADD CONSTRAINT "browser_automation_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_tasks" ADD CONSTRAINT "browser_automation_tasks_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "browser_automation_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_sessions" ADD CONSTRAINT "browser_automation_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_sessions" ADD CONSTRAINT "browser_automation_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "browser_automation_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_sessions" ADD CONSTRAINT "browser_automation_sessions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "browser_automation_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_artifacts" ADD CONSTRAINT "browser_automation_artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_artifacts" ADD CONSTRAINT "browser_automation_artifacts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "browser_automation_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_artifacts" ADD CONSTRAINT "browser_automation_artifacts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "browser_automation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_action_logs" ADD CONSTRAINT "browser_automation_action_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_action_logs" ADD CONSTRAINT "browser_automation_action_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "browser_automation_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_automation_action_logs" ADD CONSTRAINT "browser_automation_action_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "browser_automation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
