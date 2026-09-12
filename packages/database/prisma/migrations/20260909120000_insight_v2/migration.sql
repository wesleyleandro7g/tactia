-- Insight v2: entity linkage, financial impact, ranking score, dedup fingerprint,
-- root-cause drivers and lifecycle (auto-resolve / dismiss reason).

ALTER TABLE "insights"
  ADD COLUMN "entity_type" TEXT,
  ADD COLUMN "entity_id" UUID,
  ADD COLUMN "impact_amount" DECIMAL(18,4),
  ADD COLUMN "confidence" DOUBLE PRECISION,
  ADD COLUMN "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "fingerprint" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "drivers" JSONB,
  ADD COLUMN "auto_resolved_at" TIMESTAMP(3),
  ADD COLUMN "dismiss_reason" TEXT;

-- Existing insights were tenant-wide: their identity is the rule key.
UPDATE "insights" SET "fingerprint" = "rule_key" WHERE "fingerprint" = '';

ALTER TABLE "insights" ALTER COLUMN "fingerprint" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "insights_tenant_id_fingerprint_status_idx" ON "insights"("tenant_id", "fingerprint", "status");

-- CreateIndex
CREATE INDEX "insights_tenant_id_status_score_idx" ON "insights"("tenant_id", "status", "score");

-- CreateIndex
CREATE INDEX "insights_tenant_id_entity_type_entity_id_idx" ON "insights"("tenant_id", "entity_type", "entity_id");
