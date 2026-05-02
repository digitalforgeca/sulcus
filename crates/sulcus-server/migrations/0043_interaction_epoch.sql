-- Phase A: Interaction-based decay support
-- All statements are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS recall_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS last_recalled_at TIMESTAMPTZ;
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS interaction_epoch BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS namespace_counters (
  tenant_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  interaction_epoch BIGINT NOT NULL DEFAULT 0,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, namespace)
);
