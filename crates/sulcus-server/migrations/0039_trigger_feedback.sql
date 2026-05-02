-- Trigger feedback for SITU training data.
-- Records "this trigger fired and shouldn't have" (false_positive)
-- or "a trigger should have fired here but didn't" (false_negative).
-- Together with trigger_log (which records actual fires), this provides
-- the training dataset for SITU — the SI Trigger Unit.

CREATE TABLE IF NOT EXISTS trigger_feedback (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       VARCHAR(64) NOT NULL,
    trigger_id      UUID,                     -- which trigger (NULL for false_negative = "something should have fired")
    trigger_log_id  UUID,                     -- reference to the fire event (NULL for false_negative)
    
    -- Feedback type
    feedback_type   VARCHAR(32) NOT NULL,     -- 'false_positive', 'false_negative', 'correct', 'wrong_action'
    
    -- Context at the time of the event
    event_type      VARCHAR(64),              -- 'memory_created', 'heat_threshold', 'recall', etc.
    memory_id       UUID,                     -- the memory involved (if any)
    context_snapshot JSONB,                   -- graph state snapshot (neighboring memories, heat levels, etc.)
    
    -- What the user/agent thinks should have happened
    expected_action VARCHAR(64),              -- 'fire', 'no_fire', 'different_action'
    notes           TEXT,                     -- free-text explanation
    
    -- Source
    source          VARCHAR(64) DEFAULT 'api',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trigger_feedback_tenant
    ON trigger_feedback (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trigger_feedback_trigger
    ON trigger_feedback (trigger_id);
