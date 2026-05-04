-- Migration 0052: Namespace suspension support
-- Adds soft-suspend columns to namespace_counters.
-- When suspended_at IS NOT NULL the namespace is suspended:
--   sync writes return 403 namespace_suspended
--   reads still work so history is accessible
--   toggled via PATCH /api/v1/admin/agents/:namespace/status

ALTER TABLE namespace_counters ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

ALTER TABLE namespace_counters ADD COLUMN IF NOT EXISTS suspended_by TEXT;
