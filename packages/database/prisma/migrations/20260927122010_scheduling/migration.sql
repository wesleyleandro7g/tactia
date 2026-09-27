-- CreateEnum
CREATE TYPE "ScheduleTarget" AS ENUM ('ai_agent', 'action', 'automation');

-- CreateEnum
CREATE TYPE "ScheduleEffectMode" AS ENUM ('propose', 'auto_execute');

-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('daily', 'weekly', 'monthly', 'custom', 'manual');

-- CreateEnum
CREATE TYPE "ScheduleRepeatMode" AS ENUM ('infinite', 'count');

-- CreateEnum
CREATE TYPE "ScheduleOccurrenceStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "target" "ScheduleTarget" NOT NULL,
    "effect_mode" "ScheduleEffectMode" NOT NULL DEFAULT 'propose',
    "frequency" "ScheduleFrequency" NOT NULL,
    "recurrence_config" JSONB NOT NULL DEFAULT '{}',
    "cron_expression" TEXT,
    "timezone" TEXT,
    "repeat_mode" "ScheduleRepeatMode" NOT NULL DEFAULT 'infinite',
    "max_occurrences" INTEGER,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "ai_config" JSONB,
    "action_type" "ActionType",
    "action_input" JSONB,
    "last_run_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_occurrences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "period_key" TEXT NOT NULL,
    "status" "ScheduleOccurrenceStatus" NOT NULL DEFAULT 'pending',
    "origin" TEXT NOT NULL DEFAULT 'system',
    "action_execution_id" UUID,
    "output" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedules_tenant_id_enabled_idx" ON "schedules"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "schedules_tenant_id_created_at_idx" ON "schedules"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "schedule_occurrences_tenant_id_status_idx" ON "schedule_occurrences"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "schedule_occurrences_tenant_id_created_at_idx" ON "schedule_occurrences"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "schedule_occurrences_schedule_id_idx" ON "schedule_occurrences"("schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_occurrences_tenant_id_schedule_id_period_key_key" ON "schedule_occurrences"("tenant_id", "schedule_id", "period_key");

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
