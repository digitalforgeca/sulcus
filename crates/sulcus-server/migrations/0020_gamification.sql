CREATE TABLE IF NOT EXISTS xp_ledger (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    reason      TEXT NOT NULL,          -- "memory.add", "sync", "days_active", "edge_added", etc.
    xp          INT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS xp_ledger_tenant ON xp_ledger (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_profile (
    tenant_id   TEXT PRIMARY KEY,
    total_xp    INT NOT NULL DEFAULT 0,
    level       INT NOT NULL DEFAULT 1,
    badges      TEXT[] NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
