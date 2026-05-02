-- Soft delete: archived memories are hidden from queries but recoverable.
-- Consolidate sets archived_at instead of DELETE. Restore clears it.
-- Hard purge after 30 days via scheduled cleanup.

ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

-- Index for fast filtering (most queries exclude archived)
CREATE INDEX IF NOT EXISTS idx_golden_index_archived
    ON golden_index (tenant_id, archived_at)
    WHERE archived_at IS NOT NULL;

-- Archive table for audit trail (who archived what and why)
CREATE TABLE IF NOT EXISTS archive_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    node_id UUID NOT NULL,
    namespace TEXT NOT NULL DEFAULT 'default',
    pointer_summary TEXT,
    memory_type TEXT,
    current_heat REAL,
    archived_by TEXT DEFAULT 'system',
    reason TEXT DEFAULT 'consolidate',
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_archive_log_tenant
    ON archive_log (tenant_id, archived_at DESC);
