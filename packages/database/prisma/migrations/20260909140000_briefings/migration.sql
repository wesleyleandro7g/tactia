-- Weekly briefings (Etapa 11): narrative + deterministic facts used to validate numbers.

CREATE TABLE "briefings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "briefings_tenant_id_created_at_idx" ON "briefings"("tenant_id", "created_at");
CREATE INDEX "briefings_tenant_id_period_from_period_to_idx" ON "briefings"("tenant_id", "period_from", "period_to");

ALTER TABLE "briefings"
  ADD CONSTRAINT "briefings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
