-- Interactions v2: richer intents, sentiment, urgency and product linkage.

-- AlterEnum
ALTER TYPE "InteractionIntent" ADD VALUE IF NOT EXISTS 'purchase_intent';
ALTER TYPE "InteractionIntent" ADD VALUE IF NOT EXISTS 'cancellation_intent';
ALTER TYPE "InteractionIntent" ADD VALUE IF NOT EXISTS 'price_objection';
ALTER TYPE "InteractionIntent" ADD VALUE IF NOT EXISTS 'delivery_issue';
ALTER TYPE "InteractionIntent" ADD VALUE IF NOT EXISTS 'support';

-- CreateEnum
CREATE TYPE "InteractionUrgency" AS ENUM ('low', 'medium', 'high');

-- AlterTable
ALTER TABLE "interactions"
  ADD COLUMN "sentiment" DECIMAL(3,2),
  ADD COLUMN "urgency" "InteractionUrgency",
  ADD COLUMN "product_id" UUID;

-- CreateIndex
CREATE INDEX "interactions_tenant_id_product_id_idx" ON "interactions"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "interactions_tenant_id_urgency_occurred_at_idx" ON "interactions"("tenant_id", "urgency", "occurred_at");

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
