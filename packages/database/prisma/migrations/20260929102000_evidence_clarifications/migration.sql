ALTER TABLE "whatsapp_agent_configs"
  ADD COLUMN "clarifications_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clarification_start_hour" INTEGER NOT NULL DEFAULT 9,
  ADD COLUMN "clarification_end_hour" INTEGER NOT NULL DEFAULT 18,
  ADD COLUMN "clarification_max_per_day" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "clarification_cooldown_hours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "clarification_weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::INTEGER[];

CREATE TABLE "evidence_clarifications" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "gap_id" UUID NOT NULL,
  "number_id" UUID NOT NULL,
  "question" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "sent_at" TIMESTAMP(3),
  "response_text" TEXT,
  "response_message_id" TEXT,
  "answered_at" TIMESTAMP(3),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "evidence_clarifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evidence_clarifications_gap_id_key" ON "evidence_clarifications"("gap_id");
CREATE UNIQUE INDEX "evidence_clarifications_response_message_id_key" ON "evidence_clarifications"("response_message_id");
CREATE INDEX "evidence_clarifications_tenant_id_status_idx" ON "evidence_clarifications"("tenant_id", "status");
CREATE INDEX "evidence_clarifications_number_id_status_sent_at_idx" ON "evidence_clarifications"("number_id", "status", "sent_at");

ALTER TABLE "evidence_clarifications" ADD CONSTRAINT "evidence_clarifications_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence_clarifications" ADD CONSTRAINT "evidence_clarifications_gap_id_fkey"
  FOREIGN KEY ("gap_id") REFERENCES "evidence_gaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence_clarifications" ADD CONSTRAINT "evidence_clarifications_number_id_fkey"
  FOREIGN KEY ("number_id") REFERENCES "whatsapp_authorized_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_agent_configs" ADD CONSTRAINT "whatsapp_agent_configs_clarification_hours_check"
  CHECK ("clarification_start_hour" >= 0 AND "clarification_start_hour" <= 23 AND "clarification_end_hour" >= 1 AND "clarification_end_hour" <= 24 AND "clarification_start_hour" < "clarification_end_hour");
ALTER TABLE "whatsapp_agent_configs" ADD CONSTRAINT "whatsapp_agent_configs_clarification_budget_check"
  CHECK ("clarification_max_per_day" >= 1 AND "clarification_max_per_day" <= 10 AND "clarification_cooldown_hours" >= 1 AND "clarification_cooldown_hours" <= 168);
