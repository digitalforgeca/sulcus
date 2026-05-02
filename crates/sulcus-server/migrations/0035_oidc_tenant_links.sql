-- Persistent OIDC-to-tenant mapping, independent of API keys.
-- Revoking keys no longer breaks dashboard login.
CREATE TABLE IF NOT EXISTS oidc_tenant_links (
    keycloak_user_id VARCHAR(64) PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL,
    linked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oidc_links_tenant ON oidc_tenant_links(tenant_id);
