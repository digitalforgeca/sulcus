-- Training signals for SIU feedback loop (local mirror of server migration 0038).
CREATE TABLE IF NOT EXISTS training_signals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id   UUID NOT NULL,
    tenant_id   VARCHAR(64) NOT NULL DEFAULT 'local',
    namespace   VARCHAR(128),
    signal_type VARCHAR(32) NOT NULL,
    predicted_type  VARCHAR(32),
    predicted_store BOOLEAN,
    predicted_conf  REAL,
    corrected_type  VARCHAR(32),
    corrected_store BOOLEAN,
    content_snapshot TEXT,
    source      VARCHAR(64) DEFAULT 'plugin',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_signals_created
    ON training_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_signals_memory
    ON training_signals (memory_id);
