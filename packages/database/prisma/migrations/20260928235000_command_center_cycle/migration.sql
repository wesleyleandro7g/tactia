ALTER TABLE "plan_step_executions"
  ADD COLUMN "plan_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "decision_snapshot" JSONB NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX "operational_evidence_tenant_id_external_ref_key"
  ON "operational_evidence"("tenant_id", "external_ref");

CREATE UNIQUE INDEX "plans_tenant_id_recommendation_id_key"
  ON "plans"("tenant_id", "recommendation_id");

CREATE UNIQUE INDEX "plan_step_executions_action_execution_id_key"
  ON "plan_step_executions"("action_execution_id");
