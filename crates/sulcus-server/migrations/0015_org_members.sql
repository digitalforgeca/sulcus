-- 0015_org_members.sql — Per-org member tracking for seat governance
CREATE TABLE IF NOT EXISTS org_members (
    tenant_id VARCHAR(64) NOT NULL,
    email     TEXT NOT NULL,
    name      TEXT,
    role      TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_org_members_tenant ON org_members(tenant_id);
