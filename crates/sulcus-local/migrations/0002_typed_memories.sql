-- 0002_typed_memories.sql (PostgreSQL)
BEGIN;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'episodic';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS updated_at TEXT;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS valid_to TEXT;
UPDATE edges SET valid_from = CURRENT_TIMESTAMP WHERE valid_from IS NULL;
ALTER TABLE active_index ADD COLUMN IF NOT EXISTS consecutive_active_ticks INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_nodes_fts ON nodes USING GIN (to_tsvector('english', pointer_summary));
CREATE INDEX IF NOT EXISTS idx_memory_ops_status ON memory_ops(status);
CREATE INDEX IF NOT EXISTS idx_edges_valid_to ON edges(valid_to);
COMMIT;
