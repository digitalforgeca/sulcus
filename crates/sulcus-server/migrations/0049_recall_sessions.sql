-- Migration 0049: recall_sessions table for SIRU training data
-- Tracks entire recall events (what was searched, what was injected, budget used).
-- This becomes the training corpus for the SIRU (Sulcus Intelligence Recall Unit) model.
-- Distinct from recall_log (0021) which tracks per-node feedback signals.

CREATE TABLE IF NOT EXISTS recall_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           TEXT NOT NULL,
    namespace           TEXT NOT NULL DEFAULT 'default',
    agent_id            TEXT,                              -- which agent triggered the recall
    query_text          TEXT NOT NULL,                     -- the user prompt that triggered recall
    
    -- What was recalled (ordered arrays — parallel structure)
    memory_ids          TEXT[] NOT NULL DEFAULT '{}',      -- ordered list of memory IDs injected
    memory_scores       REAL[] NOT NULL DEFAULT '{}',      -- parallel array: composite scores
    memory_sources      TEXT[] NOT NULL DEFAULT '{}',      -- parallel array: source signals (semantic/hot/entity/profile)
    
    -- Budget and selection stats
    token_budget        INTEGER NOT NULL DEFAULT 500,
    tokens_used         INTEGER NOT NULL DEFAULT 0,
    candidates_total    INTEGER NOT NULL DEFAULT 0,       -- how many candidates were considered
    candidates_selected INTEGER NOT NULL DEFAULT 0,       -- how many made it into context
    
    -- Signal breakdown
    semantic_count      INTEGER NOT NULL DEFAULT 0,
    hot_count           INTEGER NOT NULL DEFAULT 0,
    entity_count        INTEGER NOT NULL DEFAULT 0,
    entity_hints        TEXT[] NOT NULL DEFAULT '{}',       -- entity names extracted from the prompt
    
    -- Quality feedback (filled in later)
    -- NULL = no feedback yet, true = recall was useful, false = not useful
    was_useful          BOOLEAN,
    feedback_source     TEXT,                               -- 'auto_heat_boost' | 'manual' | 'auto_no_interaction'
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for SIRU training data export
CREATE INDEX IF NOT EXISTS idx_recall_sessions_tenant ON recall_sessions(tenant_id, namespace);
CREATE INDEX IF NOT EXISTS idx_recall_sessions_created ON recall_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recall_sessions_feedback ON recall_sessions(was_useful) WHERE was_useful IS NOT NULL;
