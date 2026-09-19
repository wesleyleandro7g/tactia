-- Preserve the original funnel; short-form leads have genuinely unknown qualification.
ALTER TABLE "acquisition_leads"
  ALTER COLUMN "segment" DROP NOT NULL,
  ALTER COLUMN "employee_range" DROP NOT NULL,
  ALTER COLUMN "revenue_range" DROP NOT NULL,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN "attribution" JSONB;
