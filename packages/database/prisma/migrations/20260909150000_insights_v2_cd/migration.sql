-- Insights v2 fases C+D: metas, funil, memória, feedback, entidades externas e dimensões.

ALTER TABLE "customers"
  ADD COLUMN "segment" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "acquisition_source" TEXT;

ALTER TABLE "leads" ADD COLUMN "seller_id" UUID;
CREATE INDEX "leads_tenant_id_seller_id_idx" ON "leads"("tenant_id", "seller_id");
ALTER TABLE "leads"
  ADD CONSTRAINT "leads_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products" ADD COLUMN "supplier" TEXT;

ALTER TABLE "sales"
  ADD COLUMN "payment_method" TEXT,
  ADD COLUMN "channel" TEXT,
  ADD COLUMN "region" TEXT;

ALTER TABLE "activities"
  ADD COLUMN "data_source_id" UUID,
  ADD COLUMN "external_id" TEXT;
CREATE UNIQUE INDEX "activities_tenant_id_data_source_id_external_id_key"
  ON "activities"("tenant_id", "data_source_id", "external_id");

CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'tenant',
    "scope_id" UUID,
    "metric_key" TEXT NOT NULL,
    "period_type" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "target" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "goals_tenant_id_period_start_idx" ON "goals"("tenant_id", "period_start");
CREATE INDEX "goals_tenant_id_metric_key_idx" ON "goals"("tenant_id", "metric_key");
ALTER TABLE "goals" ADD CONSTRAINT "goals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "lead_stage_transitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "seller_id" UUID,
    CONSTRAINT "lead_stage_transitions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lead_stage_transitions_tenant_id_occurred_at_idx" ON "lead_stage_transitions"("tenant_id", "occurred_at");
CREATE INDEX "lead_stage_transitions_lead_id_occurred_at_idx" ON "lead_stage_transitions"("lead_id", "occurred_at");
ALTER TABLE "lead_stage_transitions" ADD CONSTRAINT "lead_stage_transitions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_stage_transitions" ADD CONSTRAINT "lead_stage_transitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "business_facts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'user',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_facts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "business_facts_tenant_id_created_at_idx" ON "business_facts"("tenant_id", "created_at");
CREATE INDEX "business_facts_tenant_id_kind_idx" ON "business_facts"("tenant_id", "kind");
ALTER TABLE "business_facts" ADD CONSTRAINT "business_facts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "business_facts" ADD CONSTRAINT "business_facts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "insight_feedbacks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "insight_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "useful" BOOLEAN NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "insight_feedbacks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "insight_feedbacks_insight_id_user_id_key" ON "insight_feedbacks"("insight_id", "user_id");
CREATE INDEX "insight_feedbacks_tenant_id_created_at_idx" ON "insight_feedbacks"("tenant_id", "created_at");
ALTER TABLE "insight_feedbacks" ADD CONSTRAINT "insight_feedbacks_insight_id_fkey" FOREIGN KEY ("insight_id") REFERENCES "insights"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "insight_feedbacks" ADD CONSTRAINT "insight_feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "tenant_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "thresholds" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'overdue', 'cancelled');

CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data_source_id" UUID,
    "external_id" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "supplier" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "expenses_tenant_id_data_source_id_external_id_key" ON "expenses"("tenant_id", "data_source_id", "external_id");
CREATE INDEX "expenses_tenant_id_occurred_at_idx" ON "expenses"("tenant_id", "occurred_at");
CREATE INDEX "expenses_tenant_id_category_idx" ON "expenses"("tenant_id", "category");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data_source_id" UUID,
    "external_id" TEXT,
    "sale_id" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "method" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payments_tenant_id_data_source_id_external_id_key" ON "payments"("tenant_id", "data_source_id", "external_id");
CREATE INDEX "payments_tenant_id_status_due_at_idx" ON "payments"("tenant_id", "status", "due_at");
CREATE INDEX "payments_tenant_id_sale_id_idx" ON "payments"("tenant_id", "sale_id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "inventory_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data_source_id" UUID,
    "external_id" TEXT,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "min_quantity" DECIMAL(18,4),
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_levels_tenant_id_data_source_id_external_id_key" ON "inventory_levels"("tenant_id", "data_source_id", "external_id");
CREATE INDEX "inventory_levels_tenant_id_product_id_recorded_at_idx" ON "inventory_levels"("tenant_id", "product_id", "recorded_at");
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data_source_id" UUID,
    "external_id" TEXT,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "spend" DECIMAL(18,4) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "campaigns_tenant_id_data_source_id_external_id_key" ON "campaigns"("tenant_id", "data_source_id", "external_id");
CREATE INDEX "campaigns_tenant_id_source_idx" ON "campaigns"("tenant_id", "source");
CREATE INDEX "campaigns_tenant_id_starts_at_idx" ON "campaigns"("tenant_id", "starts_at");
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
