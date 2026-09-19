-- Company selection is now isolated per PKCE flow in auth_verifications.
-- Session-wide state could silently switch tenants across simultaneous tabs.
ALTER TABLE "auth_sessions" DROP COLUMN "mcp_tenant_id";
