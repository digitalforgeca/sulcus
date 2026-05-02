-- Training signals for SIU feedback loop.
-- When a user corrects a classification (reclassify, override, reject→store),
-- the correction is logged here for periodic retraining.

CREATE TABLE IF NOT EXISTS training_signals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id   UUID NOT NULL,            -- the memory that was corrected
    tenant_id   VARCHAR(64) NOT NULL,
    namespace   VARCHAR(128),
    signal_type VARCHAR(32) NOT NULL,     -- 'reclassify', 'accept', 'reject', 'override'
    
    -- What the model predicted
    predicted_type  VARCHAR(32),          -- e.g. 'episodic'
    predicted_store BOOLEAN,              -- SIVU: model said store?
    predicted_conf  REAL,                 -- model confidence at prediction time

    -- What the human/agent corrected to
    corrected_type  VARCHAR(32),          -- e.g. 'procedural' (for reclassify)
    corrected_store BOOLEAN,              -- for SIVU overrides
    
    -- The raw text at correction time (snapshot — memory content may change)
    content_snapshot TEXT,

    -- Metadata
    source      VARCHAR(64) DEFAULT 'plugin',  -- 'plugin', 'dashboard', 'api', 'mcp'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for export queries during retraining
CREATE INDEX IF NOT EXISTS idx_training_signals_created
    ON training_signals (created_at DESC);

-- Index for per-tenant signal review
CREATE INDEX IF NOT EXISTS idx_training_signals_tenant
    ON training_signals (tenant_id, created_at DESC);

-- Index for finding signals for a specific memory
CREATE INDEX IF NOT EXISTS idx_training_signals_memory
    ON training_signals (memory_id);
