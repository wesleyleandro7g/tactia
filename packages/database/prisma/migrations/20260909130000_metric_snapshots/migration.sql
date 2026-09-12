-- Metric snapshots (Insights v2 — Etapa 11): daily materialized metric values used
-- as the source for trends, baselines and forecasts.

CREATE TABLE "metric_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "metric_key" TEXT NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT 'total',
    "dimension_key" TEXT NOT NULL DEFAULT '',
    "bucket_date" DATE NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "metric_snapshots_tenant_id_metric_key_dimension_dimension_key_bucket_date_key"
  ON "metric_snapshots"("tenant_id", "metric_key", "dimension", "dimension_key", "bucket_date");

CREATE INDEX "metric_snapshots_tenant_id_metric_key_dimension_bucket_date_idx"
  ON "metric_snapshots"("tenant_id", "metric_key", "dimension", "bucket_date");

CREATE INDEX "metric_snapshots_tenant_id_bucket_date_idx"
  ON "metric_snapshots"("tenant_id", "bucket_date");

ALTER TABLE "metric_snapshots"
  ADD CONSTRAINT "metric_snapshots_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
