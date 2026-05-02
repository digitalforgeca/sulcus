-- Sulcus Triggers: reactive memory system
-- "When X happens to memory, do Y"

BEGIN;

CREATE TABLE IF NOT EXISTS triggers (
    id TEXT PRIMARY KEY,                              -- UUID
    namespace TEXT NOT NULL DEFAULT 'default',         -- scoped to agent namespace
    name TEXT NOT NULL DEFAULT '',                     -- human-readable name
    description TEXT NOT NULL DEFAULT '',              -- what this trigger does
    enabled BOOLEAN NOT NULL DEFAULT TRUE,

    -- What fires this trigger
    event TEXT NOT NULL,                               -- on_recall, on_decay, on_store, on_boost, on_relate, on_threshold
    -- Optional filters (all nullable = "match any")
    filter_memory_type TEXT,                           -- only fire for this memory_type (episodic, semantic, preference, procedural, fact, moment)
    filter_namespace TEXT,                             -- only fire for memories in this namespace
    filter_label_pattern TEXT,                         -- ILIKE pattern match on node label
    filter_heat_below REAL,                            -- for on_threshold: fire when heat drops below this
    filter_heat_above REAL,                            -- for on_threshold: fire when heat rises above this

    -- What to do when fired
    action TEXT NOT NULL,                              -- notify, boost, pin, tag, deprecate, webhook, chain
    action_config JSONB NOT NULL DEFAULT '{}',         -- action-specific params
    -- notify:  {"message": "..."} — surface text to agent context
    -- boost:   {"strength": 0.5, "target": "self"|"<node_id>"}
    -- pin:     {} — pins the triggering node
    -- tag:     {"label": "important"}
    -- deprecate: {"reason": "auto-deprecated by trigger"}
    -- webhook: {"url": "...", "method": "POST", "headers": {...}}
    -- chain:   {"tool": "memory_boost", "args": {...}}

    -- Lifecycle
    max_fires INTEGER,                                 -- NULL = unlimited
    fire_count INTEGER NOT NULL DEFAULT 0,
    cooldown_seconds INTEGER NOT NULL DEFAULT 0,       -- minimum seconds between fires
    last_fired_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trigger_log (
    id TEXT PRIMARY KEY,                               -- UUID
    trigger_id TEXT NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
    event TEXT NOT NULL,                                -- the event that fired it
    node_id TEXT,                                       -- the memory node involved (if any)
    action TEXT NOT NULL,                               -- what action was taken
    action_result JSONB NOT NULL DEFAULT '{}',          -- result/outcome
    fired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_triggers_event ON triggers(event);
CREATE INDEX IF NOT EXISTS idx_triggers_namespace ON triggers(namespace);
CREATE INDEX IF NOT EXISTS idx_triggers_enabled ON triggers(enabled) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_trigger_log_trigger_id ON trigger_log(trigger_id);
CREATE INDEX IF NOT EXISTS idx_trigger_log_fired_at ON trigger_log(fired_at DESC);

COMMIT;
