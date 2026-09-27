-- AlterTable: per-number contact treatment
ALTER TABLE "whatsapp_authorized_numbers" ADD COLUMN "contact_name" TEXT;
ALTER TABLE "whatsapp_authorized_numbers" ADD COLUMN "contact_role" TEXT;

-- CreateEnum
CREATE TYPE "WhatsappAgentJobStatus" AS ENUM ('queued', 'running', 'done', 'cancelled', 'failed');

-- CreateTable: per-company agent communication config
CREATE TABLE "whatsapp_agent_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tone" TEXT,
    "instructions" TEXT,
    "company_context" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_agent_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_agent_configs_tenant_id_key" ON "whatsapp_agent_configs"("tenant_id");

-- CreateTable: dedicated async agent job queue
CREATE TABLE "whatsapp_agent_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number_id" UUID NOT NULL,
    "conversation_id" UUID,
    "user_id" UUID NOT NULL,
    "status" "WhatsappAgentJobStatus" NOT NULL DEFAULT 'queued',
    "request_text" TEXT NOT NULL,
    "plan" TEXT,
    "message_id" TEXT,
    "cancel_requested_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_agent_jobs_tenant_id_status_idx" ON "whatsapp_agent_jobs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_agent_jobs_number_id_status_idx" ON "whatsapp_agent_jobs"("number_id", "status");

-- AddForeignKey
ALTER TABLE "whatsapp_agent_configs" ADD CONSTRAINT "whatsapp_agent_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_agent_jobs" ADD CONSTRAINT "whatsapp_agent_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_agent_jobs" ADD CONSTRAINT "whatsapp_agent_jobs_number_id_fkey" FOREIGN KEY ("number_id") REFERENCES "whatsapp_authorized_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
