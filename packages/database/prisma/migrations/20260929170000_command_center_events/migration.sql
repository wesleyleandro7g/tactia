CREATE TABLE "command_center_events" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "event_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "command_center_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "command_center_events_tenant_id_event_key_key" ON "command_center_events"("tenant_id", "event_key");
CREATE INDEX "command_center_events_tenant_id_name_occurred_at_idx" ON "command_center_events"("tenant_id", "name", "occurred_at");
ALTER TABLE "command_center_events" ADD CONSTRAINT "command_center_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
