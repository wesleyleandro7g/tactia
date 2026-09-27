CREATE TYPE "AgentSkillKind" AS ENUM ('global', 'secondary');

CREATE TABLE "agent_skills" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "kind" "AgentSkillKind" NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "markdown" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_skill_bindings" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_skill_bindings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_skills_tenant_id_slug_key" ON "agent_skills"("tenant_id", "slug");
CREATE UNIQUE INDEX "agent_skills_id_tenant_id_key" ON "agent_skills"("id", "tenant_id");
CREATE INDEX "agent_skills_tenant_id_kind_enabled_idx" ON "agent_skills"("tenant_id", "kind", "enabled");
CREATE UNIQUE INDEX "agent_skills_one_global_per_tenant" ON "agent_skills"("tenant_id") WHERE "kind" = 'global';
CREATE UNIQUE INDEX "agent_skill_bindings_skill_id_resource_type_resource_id_key" ON "agent_skill_bindings"("skill_id", "resource_type", "resource_id");
CREATE INDEX "agent_skill_bindings_tenant_id_resource_type_resource_id_idx" ON "agent_skill_bindings"("tenant_id", "resource_type", "resource_id");
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_skill_bindings" ADD CONSTRAINT "agent_skill_bindings_skill_id_tenant_id_fkey" FOREIGN KEY ("skill_id", "tenant_id") REFERENCES "agent_skills"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
