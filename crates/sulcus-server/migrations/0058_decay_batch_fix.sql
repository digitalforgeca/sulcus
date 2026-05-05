-- Migration 0058: Decay worker batch fix
-- 
-- Root cause of 548s decay lock cascade (LoCoMo benchmark incident 2026-05-05):
-- The decay UPDATE set `updated_at = now()` on every row. The edges generation
-- query then saw ALL nodes as "recently updated" (within the 900s window) and
-- performed a full O(n^2) self-join across all 1400+ benchmark nodes, holding
-- table locks for 548 seconds and cascading into search 500s.
--
-- Fix: Add a dedicated `last_decayed_at` column to track when decay last ran
-- per node. Decay queries now update `last_decayed_at` instead of `updated_at`.
-- The time-based decay formula uses `last_decayed_at` for elapsed time.
-- `updated_at` is now reserved for semantic changes (store/boost/update ops).
-- The edges query window (900s) will see only genuinely modified nodes.

ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS last_decayed_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Index to accelerate decay queries (filter by tenant + heat > floor)
CREATE INDEX IF NOT EXISTS idx_golden_index_decay
    ON golden_index (tenant_id, last_decayed_at)
    WHERE current_heat > 0.01 AND is_pinned = false;
