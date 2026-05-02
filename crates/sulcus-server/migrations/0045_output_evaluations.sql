-- SILU Output Evaluation: recursive LM supervisor
-- All statements idempotent

CREATE TABLE IF NOT EXISTS output_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  agent_label TEXT NOT NULL DEFAULT '',
  output_text TEXT NOT NULL,
  prompt_summary TEXT,
  alignment_score REAL NOT NULL,
  alignment_status TEXT NOT NULL,
  issues JSONB NOT NULL DEFAULT '[]',
  corrections JSONB NOT NULL DEFAULT '[]',
  memories_checked INT NOT NULL DEFAULT 0,
  evaluation_ms INT NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT 'gpt-5.4-nano',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_output_eval_tenant ON output_evaluations(tenant_id, namespace);
CREATE INDEX IF NOT EXISTS idx_output_eval_created ON output_evaluations(created_at DESC);
