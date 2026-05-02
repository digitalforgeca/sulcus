-- 0006_sso_config.sql
-- Add OIDC configuration for enterprise tenants

CREATE TABLE IF NOT EXISTS sso_tenants (
    tenant_id VARCHAR(64) PRIMARY KEY,
    issuer_url TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret_enc BYTEA, -- Optional client secret, encrypted
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sso_tenants_issuer ON sso_tenants(issuer_url);
