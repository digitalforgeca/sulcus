CREATE TABLE IF NOT EXISTS activity_log (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    actor       TEXT NOT NULL,          -- agent name / org_name / "system"
    action      TEXT NOT NULL,          -- "memory.add", "memory.delete", "memory.pin", "sync", "login", "billing.upgrade", etc.
    target_id   UUID,                   -- affected node id if applicable
    target_label TEXT,                  -- human label snapshot
    metadata    JSONB,                  -- before/after diffs, extra context
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_tenant_created ON activity_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_actor ON activity_log (tenant_id, actor);
