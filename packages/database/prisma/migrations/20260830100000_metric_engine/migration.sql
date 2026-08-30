-- CreateTable
CREATE TABLE "metrics" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "metrics_tenant_id_key_key" ON "metrics"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "metrics_tenant_id_idx" ON "metrics"("tenant_id");

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
