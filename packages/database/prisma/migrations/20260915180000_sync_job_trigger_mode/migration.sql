-- Sync job origin (operator vs daily) and read mode (full table vs 3-month window).

CREATE TYPE "SyncJobTrigger" AS ENUM ('manual', 'scheduled');
CREATE TYPE "SyncJobMode" AS ENUM ('full', 'incremental');

ALTER TABLE "sync_jobs"
    ADD COLUMN "trigger" "SyncJobTrigger" NOT NULL DEFAULT 'manual',
    ADD COLUMN "mode" "SyncJobMode" NOT NULL DEFAULT 'full';
