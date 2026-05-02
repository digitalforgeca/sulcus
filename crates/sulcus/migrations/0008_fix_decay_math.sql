-- Fix thermodynamics decay math by separating last_access (ignition) from last_decay (tick)
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS last_decayed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_nodes_last_decayed ON nodes(last_decayed_at);
