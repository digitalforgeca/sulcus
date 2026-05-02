-- Sulcus Triggers: reactive memory system (cloud)
CREATE TABLE IF NOT EXISTS triggers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    event TEXT NOT NULL,
    filter_memory_type TEXT,
    filter_namespace TEXT,
    filter_label_pattern TEXT,
    filter_heat_below REAL,
    filter_heat_above REAL,
    action TEXT NOT NULL,
    action_config JSONB NOT NULL DEFAULT '{}',
    max_fires INTEGER,
    fire_count INTEGER NOT NULL DEFAULT 0,
    cooldown_seconds INTEGER NOT NULL DEFAULT 0,
    last_fired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trigger_log (
    id TEXT PRIMARY KEY,
    trigger_id TEXT NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL,
    event TEXT NOT NULL,
    node_id TEXT,
    action TEXT NOT NULL,
    action_result JSONB NOT NULL DEFAULT '{}',
    fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_triggers_tenant ON triggers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_triggers_event ON triggers(event);
CREATE INDEX IF NOT EXISTS idx_trigger_log_tenant ON trigger_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trigger_log_fired_at ON trigger_log(fired_at DESC);
