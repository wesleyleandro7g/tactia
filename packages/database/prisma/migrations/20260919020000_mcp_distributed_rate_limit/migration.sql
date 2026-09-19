CREATE TABLE "mcp_rate_limit_buckets" (
  "key" TEXT PRIMARY KEY,
  "window_started_at" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "mcp_rate_limit_buckets_expires_at_idx"
  ON "mcp_rate_limit_buckets"("expires_at");
