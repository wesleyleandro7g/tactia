-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('anomaly', 'performance', 'opportunity', 'warning');

-- CreateEnum
CREATE TYPE "InsightSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "RecommendationPriority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('pending', 'accepted', 'rejected', 'dismissed');

-- CreateTable
CREATE TABLE "insights" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "InsightType" NOT NULL,
    "severity" "InsightSeverity" NOT NULL,
    "status" "InsightStatus" NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "insight_id" UUID NOT NULL,
    "priority" "RecommendationPriority" NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "action_type" TEXT,
    "metadata" JSONB,
    "accepted_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insights_tenant_id_status_idx" ON "insights"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "insights_tenant_id_created_at_idx" ON "insights"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "insights_tenant_id_rule_key_status_idx" ON "insights"("tenant_id", "rule_key", "status");

-- CreateIndex
CREATE INDEX "recommendations_tenant_id_status_idx" ON "recommendations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "recommendations_tenant_id_created_at_idx" ON "recommendations"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "recommendations_insight_id_idx" ON "recommendations"("insight_id");

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_insight_id_fkey" FOREIGN KEY ("insight_id") REFERENCES "insights"("id") ON DELETE CASCADE ON UPDATE CASCADE;
