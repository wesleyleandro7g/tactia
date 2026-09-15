-- Data source types are catalog-driven (string), so new integrations do not
-- require a Prisma enum migration.
ALTER TABLE "data_sources" ALTER COLUMN "type" TYPE TEXT USING "type"::text;

DROP TYPE "DataSourceType";
