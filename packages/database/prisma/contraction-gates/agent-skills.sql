-- Run manually before creating/applying the contraction migration that removes
-- tenants.browser_agent_skills and browser_automation_profiles.skills.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "browser_automation_profiles" p
    WHERE btrim(p."skills") <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM "agent_skill_bindings" b
        WHERE b."tenant_id" = p."tenant_id"
          AND b."resource_type" = 'browser_profile'
          AND b."resource_id" = p."id"::text
      )
  ) THEN
    RAISE EXCEPTION 'AGENT_SKILL_CONTRACTION_BLOCKED: existem perfis com orientação legada sem skill vinculada';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "tenants" t
    WHERE btrim(t."browser_agent_skills") <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "agent_skills" s
        WHERE s."tenant_id" = t."id" AND s."kind" = 'global'
      )
  ) THEN
    RAISE EXCEPTION 'AGENT_SKILL_CONTRACTION_BLOCKED: existe orientação global legada sem global migrada';
  END IF;
END $$;
