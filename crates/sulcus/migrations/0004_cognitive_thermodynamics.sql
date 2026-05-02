
BEGIN;

ALTER TABLE nodes
    ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS stability REAL NOT NULL DEFAULT 1.0;

CREATE INDEX IF NOT EXISTS idx_nodes_last_accessed ON nodes(last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_nodes_stability ON nodes(stability);

COMMIT;