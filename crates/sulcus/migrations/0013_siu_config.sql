-- SIU (Sulcus Intelligence Unit) configuration for local tenant
CREATE TABLE IF NOT EXISTS siu_config (
    tenant_id VARCHAR(64) PRIMARY KEY,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
