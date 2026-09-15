-- Flexible business data: catalog of custom fields + JSONB bags on core entities.

CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custom_field_definitions_field_type_check" CHECK ("field_type" IN (
        'text', 'number', 'boolean', 'date', 'datetime', 'select', 'multiselect', 'object', 'array'
    )),
    CONSTRAINT "custom_field_definitions_entity_type_check" CHECK ("entity_type" IN (
        'customer', 'product', 'sale', 'sale_item'
    )),
    CONSTRAINT "custom_field_definitions_field_key_check" CHECK ("field_key" ~ '^[a-z][a-z0-9_]{0,63}$')
);

CREATE UNIQUE INDEX "custom_field_definitions_tenant_id_entity_type_field_key_key"
    ON "custom_field_definitions"("tenant_id", "entity_type", "field_key");

CREATE INDEX "custom_field_definitions_tenant_id_entity_type_idx"
    ON "custom_field_definitions"("tenant_id", "entity_type");

ALTER TABLE "custom_field_definitions"
    ADD CONSTRAINT "custom_field_definitions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customers"
    ADD COLUMN "custom_data" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "products"
    ADD COLUMN "custom_data" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "sales"
    ADD COLUMN "custom_data" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "sale_items"
    ADD COLUMN "custom_data" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "customers_custom_data_idx" ON "customers" USING GIN ("custom_data");
CREATE INDEX "products_custom_data_idx" ON "products" USING GIN ("custom_data");
CREATE INDEX "sales_custom_data_idx" ON "sales" USING GIN ("custom_data");
CREATE INDEX "sale_items_custom_data_idx" ON "sale_items" USING GIN ("custom_data");
