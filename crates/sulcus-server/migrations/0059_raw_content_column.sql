-- raw_content column added to golden_index.
-- Column creation (ALTER TABLE ADD COLUMN IF NOT EXISTS) is now handled inline
-- in the backfill_raw_content() background task to avoid AccessExclusiveLock
-- blocking on active connections during startup.
-- This migration is intentionally empty — the work happens in background.
SELECT 1
