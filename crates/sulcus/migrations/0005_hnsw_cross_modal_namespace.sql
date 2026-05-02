-- 0005_hnsw_cross_modal_namespace.sql
-- Add HNSW index for vector performance and columns for multi-modal/namespace support.

-- 1. HNSW Index (Conditional on pgvector)
DO $$ 
BEGIN 
    CREATE INDEX idx_embeddings_hnsw ON embeddings 
    USING hnsw ((vector::vector) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
EXCEPTION WHEN others THEN 
    RAISE NOTICE 'Skipping HNSW index creation: pgvector not available or incompatible.';
END $$;

-- 2. Multi-Modal Columns
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS modality TEXT NOT NULL DEFAULT 'text';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS source_mime TEXT;
CREATE INDEX IF NOT EXISTS idx_nodes_modality ON nodes(modality);

-- 3. Multi-Agent Namespaces
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_nodes_namespace ON nodes(namespace);
CREATE INDEX IF NOT EXISTS idx_nodes_ns_heat ON nodes(namespace, current_heat DESC);
