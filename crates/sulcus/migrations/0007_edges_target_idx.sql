
-- Performance: missing index on edges(target_id) for rapid bi-directional traversal
-- and efficient isolation penalty checks during consolidation.

CREATE INDEX IF NOT EXISTS idx_edges_target_id ON edges(target_id);
