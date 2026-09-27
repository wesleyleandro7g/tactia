ALTER TABLE "messages" ADD COLUMN "browser_task_id" UUID;
CREATE UNIQUE INDEX "messages_browser_task_id_key" ON "messages"("browser_task_id");
ALTER TABLE "messages" ADD CONSTRAINT "messages_browser_task_id_fkey" FOREIGN KEY ("browser_task_id") REFERENCES "browser_automation_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
