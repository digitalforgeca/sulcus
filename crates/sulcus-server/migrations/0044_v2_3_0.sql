-- v2.3.0: Confidence Levels + Conflict Detection
-- All statements idempotent

-- Feature: Confidence Levels
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'observed';

-- Feature: Conflict Detection
CREATE TABLE IF NOT EXISTS conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  namespace TEXT,
  node_a_id UUID NOT NULL,
  node_b_id UUID NOT NULL,
  similarity REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, node_a_id, node_b_id)
);
