-- CreateTable
CREATE TABLE "whatsapp_authorized_numbers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "label" TEXT,
    "conversation_id" UUID,
    "last_inbound_message_id" TEXT,
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_authorized_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_authorized_numbers_phone_key" ON "whatsapp_authorized_numbers"("phone");

-- CreateIndex
CREATE INDEX "whatsapp_authorized_numbers_tenant_id_disabled_at_idx" ON "whatsapp_authorized_numbers"("tenant_id", "disabled_at");

-- CreateIndex
CREATE INDEX "whatsapp_authorized_numbers_user_id_idx" ON "whatsapp_authorized_numbers"("user_id");

-- AddForeignKey
ALTER TABLE "whatsapp_authorized_numbers" ADD CONSTRAINT "whatsapp_authorized_numbers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_authorized_numbers" ADD CONSTRAINT "whatsapp_authorized_numbers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_authorized_numbers" ADD CONSTRAINT "whatsapp_authorized_numbers_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
