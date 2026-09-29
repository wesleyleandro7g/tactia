CREATE TABLE "plan_review_decisions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "choice" TEXT NOT NULL,
  "reason" TEXT,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  "review_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_review_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_review_decisions_plan_id_from_version_key" ON "plan_review_decisions"("plan_id", "from_version");
CREATE INDEX "plan_review_decisions_tenant_id_created_at_idx" ON "plan_review_decisions"("tenant_id", "created_at");
ALTER TABLE "plan_review_decisions" ADD CONSTRAINT "plan_review_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_review_decisions" ADD CONSTRAINT "plan_review_decisions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_review_decisions" ADD CONSTRAINT "plan_review_decisions_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "measurement_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_review_decisions" ADD CONSTRAINT "plan_review_decisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
