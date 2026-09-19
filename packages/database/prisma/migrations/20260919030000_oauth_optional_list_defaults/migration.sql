-- The OAuth provider omits optional lists when no OIDC claims/contact data
-- are requested. PostgreSQL arrays cannot be optional in Prisma's schema.
ALTER TABLE "oauth_clients"
  ALTER COLUMN "contacts" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "post_logout_redirect_uris" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauth_refresh_tokens"
  ALTER COLUMN "requested_user_info_claims" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauth_access_tokens"
  ALTER COLUMN "requested_user_info_claims" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauth_consents"
  ALTER COLUMN "requested_user_info_claims" SET DEFAULT ARRAY[]::TEXT[];
