ALTER TABLE "tenants"
ADD COLUMN "browser_agent_skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "browser_automation_profiles"
ADD COLUMN "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
