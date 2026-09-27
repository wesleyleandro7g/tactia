ALTER TABLE "tenants"
  ALTER COLUMN "browser_agent_skills" DROP DEFAULT,
  ALTER COLUMN "browser_agent_skills" TYPE TEXT USING array_to_string("browser_agent_skills", E'\n'),
  ALTER COLUMN "browser_agent_skills" SET DEFAULT '';

ALTER TABLE "browser_automation_profiles"
  ALTER COLUMN "skills" DROP DEFAULT,
  ALTER COLUMN "skills" TYPE TEXT USING array_to_string("skills", E'\n'),
  ALTER COLUMN "skills" SET DEFAULT '';
