CREATE TABLE "company_agent_profiles" (
  "tenant_id" UUID NOT NULL PRIMARY KEY,
  "industry" TEXT NOT NULL DEFAULT '',
  "offering" TEXT NOT NULL DEFAULT '',
  "customers" TEXT NOT NULL DEFAULT '',
  "geography" TEXT NOT NULL DEFAULT '',
  "positioning" TEXT NOT NULL DEFAULT '',
  "priorities" TEXT NOT NULL DEFAULT '',
  "updated_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_agent_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE TABLE "conversation_summaries" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL UNIQUE,
  "author_user_id" UUID NOT NULL,
  "text" TEXT NOT NULL,
  "last_message_id" UUID,
  "edited_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "embedding" vector(1536),
  "embedded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_summaries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "conversation_summaries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE
);

CREATE INDEX "conversation_summaries_tenant_id_updated_at_idx" ON "conversation_summaries"("tenant_id", "updated_at");
CREATE INDEX "conversation_summaries_tenant_id_author_user_id_updated_at_idx" ON "conversation_summaries"("tenant_id", "author_user_id", "updated_at");
