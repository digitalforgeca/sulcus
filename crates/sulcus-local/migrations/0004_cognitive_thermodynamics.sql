-- 0004_cognitive_thermodynamics.sql
-- Adds per-node access tracking and thermal stability for the exponential decay model.
-- H(t) = H_0 * exp(-lambda * dt_seconds / stability)
--   last_accessed_at: wall-clock timestamp of most recent ignition (heat bump)
--   stability:        dimensionless inertia multiplier; ignite multiplies it by 1.5

BEGIN;

ALTER TABLE nodes
    ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS stability REAL NOT NULL DEFAULT 1.0;

CREATE INDEX IF NOT EXISTS idx_nodes_last_accessed ON nodes(last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_nodes_stability ON nodes(stability);

COMMIT;