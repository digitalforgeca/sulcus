-- Add per-node thermodynamic control fields to local nodes table.
-- Mirrors the server-side migration 0021 columns.

ALTER TABLE nodes
    ADD COLUMN IF NOT EXISTS decay_class  TEXT NOT NULL DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS min_heat     REAL,
    ADD COLUMN IF NOT EXISTS ttl_hours    REAL,
    ADD COLUMN IF NOT EXISTS valid_from   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS valid_until  TIMESTAMPTZ;
