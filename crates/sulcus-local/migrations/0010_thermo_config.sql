-- 0010_thermo_config.sql
-- Persistent thermodynamic engine configuration for local mode.
-- Keyed by tenant_id = 'local'. Config stored as JSONB.

CREATE TABLE IF NOT EXISTS thermo_config (
    tenant_id TEXT NOT NULL PRIMARY KEY DEFAULT 'local',
    config    JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
