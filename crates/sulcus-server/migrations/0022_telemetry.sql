-- 0022: Anonymous telemetry for local installs.
--
-- Tracks instance heartbeats without collecting any memory content.
-- instance_id is a random UUID generated once per install.

CREATE TABLE IF NOT EXISTS telemetry_events (
    id               BIGSERIAL PRIMARY KEY,
    instance_id      TEXT NOT NULL,
    event            TEXT NOT NULL DEFAULT 'heartbeat',
    version          TEXT,
    os               TEXT,
    integration      TEXT,
    llm_model        TEXT,
    node_count       INT,
    edge_count       INT,
    memory_types     JSONB,
    tick_mode        TEXT,
    uptime_hours     REAL,
    sync_enabled     BOOLEAN,
    cloud_tenant     TEXT,
    mcp_tools_called BIGINT,
    panel_active     BOOLEAN,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_instance ON telemetry_events(instance_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_received ON telemetry_events(received_at DESC);
