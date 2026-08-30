-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('create_task', 'send_email', 'send_whatsapp', 'generate_report');

-- CreateEnum
CREATE TYPE "ActionExecutionStatus" AS ENUM ('pending', 'awaiting_approval', 'approved', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "actions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "ActionType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "configuration" JSONB NOT NULL,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_executions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "requested_by" UUID,
    "origin" TEXT NOT NULL DEFAULT 'user',
    "status" "ActionExecutionStatus" NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "idempotency_key" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "action_execution_id" UUID NOT NULL,
    "requested_by" UUID,
    "approved_by" UUID,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "actions_tenant_id_enabled_idx" ON "actions"("tenant_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "actions_tenant_id_type_key" ON "actions"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "action_executions_tenant_id_status_idx" ON "action_executions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "action_executions_tenant_id_created_at_idx" ON "action_executions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "action_executions_action_id_idx" ON "action_executions"("action_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_executions_tenant_id_idempotency_key_key" ON "action_executions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "approvals_tenant_id_status_idx" ON "approvals"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "approvals_tenant_id_created_at_idx" ON "approvals"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "approvals_action_execution_id_idx" ON "approvals"("action_execution_id");

-- AddForeignKey
ALTER TABLE "actions" ADD CONSTRAINT "actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_action_execution_id_fkey" FOREIGN KEY ("action_execution_id") REFERENCES "action_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
