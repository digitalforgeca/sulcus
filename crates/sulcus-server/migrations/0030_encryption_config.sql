-- 0030_encryption_config.sql
-- Customer-Managed Key (CMK) encryption settings for enterprise tenants.
--
-- Stores the tenant's Azure Key Vault reference so we can configure
-- data encryption with their own keys. The actual encryption happens
-- at the Azure Postgres Flexible Server infrastructure layer —
-- we just manage the configuration and key references.

CREATE TABLE IF NOT EXISTS encryption_config (
    tenant_id       VARCHAR(64) PRIMARY KEY,
    -- Azure Key Vault URI (e.g., https://contoso-vault.vault.azure.net)
    key_vault_uri   TEXT NOT NULL,
    -- Key name within the vault (e.g., "sulcus-data-key")
    key_name        TEXT NOT NULL,
    -- Key version (nullable = use latest)
    key_version     TEXT,
    -- Current status: pending | active | rotating | revoked | error
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- Human-readable status message (e.g., error details)
    status_message  TEXT,
    -- When encryption was first enabled
    enabled_at      TIMESTAMPTZ,
    -- Last time the key was validated / rotated
    last_validated  TIMESTAMPTZ,
    -- Who configured it (OIDC subject or API key hash)
    configured_by   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit log for encryption key changes (rotation, revocation, etc.)
CREATE TABLE IF NOT EXISTS encryption_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       VARCHAR(64) NOT NULL,
    action          VARCHAR(32) NOT NULL, -- configured | validated | rotated | revoked | error
    key_vault_uri   TEXT,
    key_name        TEXT,
    key_version     TEXT,
    details         JSONB DEFAULT '{}',
    performed_by    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_encryption_audit_tenant
    ON encryption_audit_log(tenant_id, created_at DESC);
