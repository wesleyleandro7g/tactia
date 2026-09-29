-- Central de comando: modelagem aditiva. Nenhuma tabela/coluna existente é removida.
ALTER TABLE "goals"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'preparing',
  ADD COLUMN "baseline_value" DECIMAL(18,4),
  ADD COLUMN "baseline_ref" JSONB,
  ADD COLUMN "owner_user_id" UUID,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "goals_tenant_id_status_idx" ON "goals"("tenant_id", "status");
CREATE INDEX "goals_owner_user_id_idx" ON "goals"("owner_user_id");

CREATE TABLE "plans" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "goal_id" UUID NOT NULL,
  "insight_id" UUID,
  "recommendation_id" UUID,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "scope" JSONB NOT NULL DEFAULT '{}',
  "responsible_label" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "next_review_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "plans_tenant_id_status_idx" ON "plans"("tenant_id", "status");
CREATE INDEX "plans_goal_id_idx" ON "plans"("goal_id");
CREATE INDEX "plans_recommendation_id_idx" ON "plans"("recommendation_id");
ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plans" ADD CONSTRAINT "plans_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plans" ADD CONSTRAINT "plans_insight_id_fkey" FOREIGN KEY ("insight_id") REFERENCES "insights"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "plans" ADD CONSTRAINT "plans_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "plan_steps" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plan_steps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plan_steps_plan_id_position_key" ON "plan_steps"("plan_id", "position");
CREATE INDEX "plan_steps_tenant_id_status_idx" ON "plan_steps"("tenant_id", "status");
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "plan_step_executions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "plan_step_id" UUID NOT NULL,
  "action_execution_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_step_executions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plan_step_executions_plan_step_id_action_execution_id_key" ON "plan_step_executions"("plan_step_id", "action_execution_id");
CREATE INDEX "plan_step_executions_tenant_id_idx" ON "plan_step_executions"("tenant_id");
ALTER TABLE "plan_step_executions" ADD CONSTRAINT "plan_step_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_step_executions" ADD CONSTRAINT "plan_step_executions_plan_step_id_fkey" FOREIGN KEY ("plan_step_id") REFERENCES "plan_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_step_executions" ADD CONSTRAINT "plan_step_executions_action_execution_id_fkey" FOREIGN KEY ("action_execution_id") REFERENCES "action_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "measurement_definitions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "metric_key" TEXT NOT NULL,
  "indicator" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "cohort" JSONB,
  "window_from" TIMESTAMP(3) NOT NULL,
  "window_to" TIMESTAMP(3) NOT NULL,
  "baseline" DECIMAL(18,4),
  "target" DECIMAL(18,4),
  "sources" JSONB NOT NULL DEFAULT '[]',
  "attribution" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "measurement_definitions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "measurement_definitions_tenant_id_idx" ON "measurement_definitions"("tenant_id");
CREATE INDEX "measurement_definitions_plan_id_idx" ON "measurement_definitions"("plan_id");
ALTER TABLE "measurement_definitions" ADD CONSTRAINT "measurement_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "measurement_definitions" ADD CONSTRAINT "measurement_definitions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "measurement_reviews" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "measurement_definition_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'measuring',
  "observed" DECIMAL(18,4),
  "operational_results" JSONB NOT NULL DEFAULT '[]',
  "references" JSONB NOT NULL DEFAULT '[]',
  "limitation" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "measurement_reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "measurement_reviews_tenant_id_status_idx" ON "measurement_reviews"("tenant_id", "status");
CREATE INDEX "measurement_reviews_measurement_definition_id_idx" ON "measurement_reviews"("measurement_definition_id");
ALTER TABLE "measurement_reviews" ADD CONSTRAINT "measurement_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "measurement_reviews" ADD CONSTRAINT "measurement_reviews_measurement_definition_id_fkey" FOREIGN KEY ("measurement_definition_id") REFERENCES "measurement_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "operational_evidence" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "plan_id" UUID,
  "plan_step_id" UUID,
  "kind" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "source_label" TEXT NOT NULL,
  "external_ref" TEXT,
  "event_at" TIMESTAMP(3),
  "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_until" TIMESTAMP(3),
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "operational_evidence_tenant_id_kind_idx" ON "operational_evidence"("tenant_id", "kind");
CREATE INDEX "operational_evidence_plan_id_event_at_idx" ON "operational_evidence"("plan_id", "event_at");
ALTER TABLE "operational_evidence" ADD CONSTRAINT "operational_evidence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_evidence" ADD CONSTRAINT "operational_evidence_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_evidence" ADD CONSTRAINT "operational_evidence_plan_step_id_fkey" FOREIGN KEY ("plan_step_id") REFERENCES "plan_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "evidence_gaps" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "plan_id" UUID,
  "subject" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "impact" TEXT NOT NULL DEFAULT 'medium',
  "status" TEXT NOT NULL DEFAULT 'new',
  "dedupe_key" TEXT NOT NULL,
  "sources_attempted" JSONB NOT NULL DEFAULT '[]',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "assignee_operator_id" UUID,
  "next_step" TEXT,
  "next_attempt_allowed_at" TIMESTAMP(3),
  "resolution" JSONB,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "evidence_gaps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "evidence_gaps_tenant_id_dedupe_key_key" ON "evidence_gaps"("tenant_id", "dedupe_key");
CREATE INDEX "evidence_gaps_status_impact_created_at_idx" ON "evidence_gaps"("status", "impact", "created_at");
CREATE INDEX "evidence_gaps_tenant_id_status_idx" ON "evidence_gaps"("tenant_id", "status");
ALTER TABLE "evidence_gaps" ADD CONSTRAINT "evidence_gaps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence_gaps" ADD CONSTRAINT "evidence_gaps_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evidence_gaps" ADD CONSTRAINT "evidence_gaps_assignee_operator_id_fkey" FOREIGN KEY ("assignee_operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
