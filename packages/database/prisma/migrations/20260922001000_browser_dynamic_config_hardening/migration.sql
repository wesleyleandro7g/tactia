CREATE UNIQUE INDEX "browser_executor_instances_dedicated_connection_id_key"
  ON "browser_executor_instances"("dedicated_connection_id");

ALTER TABLE "browser_executor_instances"
  ADD COLUMN "last_health_at" TIMESTAMP(3),
  ADD COLUMN "last_health_status" TEXT,
  ADD COLUMN "last_health_message" TEXT;

ALTER TABLE "browser_executor_instances"
  ADD CONSTRAINT "browser_executor_instances_dedicated_connection_id_fkey"
  FOREIGN KEY ("dedicated_connection_id") REFERENCES "data_sources"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
