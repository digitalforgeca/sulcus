-- Maps Sulcus tenants to Keycloak 26 Organization IDs.
-- This allows org.rs to proxy all org/member/invite operations to Keycloak.
CREATE TABLE IF NOT EXISTS tenant_kc_orgs (
    tenant_id TEXT PRIMARY KEY,
    kc_org_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invite throttle log — tracks invites per tenant for rate limiting.
CREATE TABLE IF NOT EXISTS org_invite_log (
    id BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invite_log_tenant_time
    ON org_invite_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invite_log_tenant_email
    ON org_invite_log (tenant_id, email, created_at DESC);
