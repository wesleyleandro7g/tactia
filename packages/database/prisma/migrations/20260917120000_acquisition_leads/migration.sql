CREATE TYPE "AcquisitionLeadStatus" AS ENUM ('new', 'contacted', 'scheduled', 'qualified', 'converted', 'closed');
CREATE TABLE "acquisition_leads" (
  "id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "whatsapp" TEXT NOT NULL,
  "phone" TEXT,
  "company" TEXT NOT NULL,
  "segment" TEXT NOT NULL,
  "segment_other" TEXT,
  "employee_range" TEXT NOT NULL,
  "revenue_range" TEXT NOT NULL,
  "systems" TEXT[] NOT NULL,
  "system_details" TEXT,
  "context" TEXT,
  "status" "AcquisitionLeadStatus" NOT NULL DEFAULT 'new',
  "tenant_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "acquisition_leads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "acquisition_leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "acquisition_leads_conversion_check" CHECK (("status" = 'converted') = ("tenant_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "acquisition_leads_submission_id_key" ON "acquisition_leads"("submission_id");
CREATE UNIQUE INDEX "acquisition_leads_tenant_id_key" ON "acquisition_leads"("tenant_id");
CREATE INDEX "acquisition_leads_status_created_at_idx" ON "acquisition_leads"("status", "created_at");
CREATE INDEX "acquisition_leads_created_at_idx" ON "acquisition_leads"("created_at");
