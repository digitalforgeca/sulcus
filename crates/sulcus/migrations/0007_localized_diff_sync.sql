-- 0007_localized_diff_sync.sql
ALTER TABLE memory_ops ADD COLUMN IF NOT EXISTS node_id TEXT;
CREATE INDEX IF NOT EXISTS idx_memory_ops_node_id ON memory_ops(node_id);
