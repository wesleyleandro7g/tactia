ALTER TABLE "auth_sessions" ADD COLUMN "mcp_tenant_id" UUID;

CREATE TABLE "auth_jwks" (
  "id" TEXT PRIMARY KEY,
  "public_key" TEXT NOT NULL,
  "private_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3),
  "alg" TEXT,
  "crv" TEXT
);

CREATE TABLE "oauth_clients" (
  "id" TEXT PRIMARY KEY,
  "client_id" TEXT NOT NULL,
  "client_secret" TEXT,
  "client_discovery_id" TEXT,
  "disabled" BOOLEAN DEFAULT false,
  "skip_consent" BOOLEAN,
  "enable_end_session" BOOLEAN,
  "subject_type" TEXT,
  "scopes" TEXT[] NOT NULL,
  "client_credentials_scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "user_id" TEXT,
  "created_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3),
  "name" TEXT,
  "uri" TEXT,
  "icon" TEXT,
  "contacts" TEXT[] NOT NULL,
  "tos" TEXT,
  "policy" TEXT,
  "software_id" TEXT,
  "software_version" TEXT,
  "software_statement" TEXT,
  "redirect_uris" TEXT[] NOT NULL,
  "post_logout_redirect_uris" TEXT[] NOT NULL,
  "backchannel_logout_uri" TEXT,
  "backchannel_logout_session_required" BOOLEAN,
  "token_endpoint_auth_method" TEXT,
  "application_type" TEXT,
  "jwks" TEXT,
  "jwks_uri" TEXT,
  "grant_types" TEXT[] NOT NULL,
  "response_types" TEXT[] NOT NULL,
  "require_pkce" BOOLEAN,
  "dpop_bound_access_tokens" BOOLEAN DEFAULT false,
  "reference_id" TEXT,
  "metadata" JSONB,
  CONSTRAINT "oauth_clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "oauth_clients_client_id_key" ON "oauth_clients"("client_id");
CREATE INDEX "oauth_clients_user_id_idx" ON "oauth_clients"("user_id");

CREATE TABLE "oauth_resources" (
  "id" TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "access_token_ttl" INTEGER,
  "refresh_token_ttl" INTEGER,
  "signing_algorithm" TEXT,
  "signing_key_id" TEXT,
  "allowed_scopes" TEXT[] NOT NULL,
  "custom_claims" JSONB,
  "dpop_bound_access_tokens_required" BOOLEAN DEFAULT false,
  "disabled" BOOLEAN DEFAULT false,
  "created_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3),
  "policy_version" INTEGER DEFAULT 1,
  "metadata" JSONB
);

CREATE UNIQUE INDEX "oauth_resources_identifier_key" ON "oauth_resources"("identifier");

CREATE TABLE "oauth_client_resources" (
  "id" TEXT PRIMARY KEY,
  "client_id" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3),
  CONSTRAINT "oauth_client_resources_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id") ON DELETE CASCADE,
  CONSTRAINT "oauth_client_resources_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "oauth_resources"("identifier") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "oauth_client_resources_client_id_resource_id_key" ON "oauth_client_resources"("client_id", "resource_id");
CREATE INDEX "oauth_client_resources_client_id_idx" ON "oauth_client_resources"("client_id");
CREATE INDEX "oauth_client_resources_resource_id_idx" ON "oauth_client_resources"("resource_id");

CREATE TABLE "oauth_refresh_tokens" (
  "id" TEXT PRIMARY KEY,
  "token" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "session_id" TEXT,
  "user_id" TEXT NOT NULL,
  "reference_id" TEXT,
  "authorization_code_id" TEXT,
  "resources" TEXT[] NOT NULL,
  "requested_user_info_claims" TEXT[] NOT NULL,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3),
  "revoked" TIMESTAMP(3),
  "rotated_at" TIMESTAMP(3),
  "rotation_replay_response" TEXT,
  "rotation_replay_expires_at" TIMESTAMP(3),
  "auth_time" TIMESTAMP(3),
  "confirmation" JSONB,
  "scopes" TEXT[] NOT NULL,
  CONSTRAINT "oauth_refresh_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id") ON DELETE CASCADE,
  CONSTRAINT "oauth_refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL,
  CONSTRAINT "oauth_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "oauth_refresh_tokens_token_key" ON "oauth_refresh_tokens"("token");
CREATE INDEX "oauth_refresh_tokens_client_id_idx" ON "oauth_refresh_tokens"("client_id");
CREATE INDEX "oauth_refresh_tokens_session_id_idx" ON "oauth_refresh_tokens"("session_id");
CREATE INDEX "oauth_refresh_tokens_user_id_idx" ON "oauth_refresh_tokens"("user_id");
CREATE INDEX "oauth_refresh_tokens_authorization_code_id_idx" ON "oauth_refresh_tokens"("authorization_code_id");

CREATE TABLE "oauth_access_tokens" (
  "id" TEXT PRIMARY KEY,
  "token" TEXT,
  "client_id" TEXT NOT NULL,
  "session_id" TEXT,
  "user_id" TEXT,
  "reference_id" TEXT,
  "authorization_code_id" TEXT,
  "resources" TEXT[] NOT NULL,
  "requested_user_info_claims" TEXT[] NOT NULL,
  "refresh_id" TEXT,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3),
  "revoked" TIMESTAMP(3),
  "confirmation" JSONB,
  "scopes" TEXT[] NOT NULL,
  CONSTRAINT "oauth_access_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id") ON DELETE CASCADE,
  CONSTRAINT "oauth_access_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL,
  CONSTRAINT "oauth_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE,
  CONSTRAINT "oauth_access_tokens_refresh_id_fkey" FOREIGN KEY ("refresh_id") REFERENCES "oauth_refresh_tokens"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "oauth_access_tokens_token_key" ON "oauth_access_tokens"("token");
CREATE INDEX "oauth_access_tokens_client_id_idx" ON "oauth_access_tokens"("client_id");
CREATE INDEX "oauth_access_tokens_session_id_idx" ON "oauth_access_tokens"("session_id");
CREATE INDEX "oauth_access_tokens_user_id_idx" ON "oauth_access_tokens"("user_id");
CREATE INDEX "oauth_access_tokens_authorization_code_id_idx" ON "oauth_access_tokens"("authorization_code_id");
CREATE INDEX "oauth_access_tokens_refresh_id_idx" ON "oauth_access_tokens"("refresh_id");

CREATE TABLE "oauth_consents" (
  "id" TEXT PRIMARY KEY,
  "client_id" TEXT NOT NULL,
  "user_id" TEXT,
  "reference_id" TEXT,
  "resources" TEXT[] NOT NULL,
  "requested_user_info_claims" TEXT[] NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "created_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "oauth_consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id") ON DELETE CASCADE,
  CONSTRAINT "oauth_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE
);

CREATE INDEX "oauth_consents_client_id_idx" ON "oauth_consents"("client_id");
CREATE INDEX "oauth_consents_user_id_idx" ON "oauth_consents"("user_id");

CREATE TABLE "oauth_client_assertions" (
  "id" TEXT PRIMARY KEY,
  "expires_at" TIMESTAMP(3) NOT NULL
);
