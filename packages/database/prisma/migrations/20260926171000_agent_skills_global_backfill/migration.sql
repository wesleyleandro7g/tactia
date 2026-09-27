-- Preserve the existing company-wide Browser Agent guidance as the new optional global skill.
INSERT INTO "agent_skills" (
  "id", "tenant_id", "kind", "slug", "title", "description", "markdown", "enabled", "created_at", "updated_at"
)
SELECT
  md5('agent-global:' || "id"::text)::uuid,
  "id",
  'global'::"AgentSkillKind",
  'company_global',
  'Orientação global da empresa',
  'Contexto geral, sistemas utilizados e encaminhamento para skills específicas.',
  "browser_agent_skills",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants"
WHERE btrim("browser_agent_skills") <> ''
ON CONFLICT DO NOTHING;
