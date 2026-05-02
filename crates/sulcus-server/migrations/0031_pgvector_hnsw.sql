-- 0031_pgvector_hnsw.sql
-- Migrate golden_index.vector from BYTEA to pgvector type with HNSW index.
-- Brings server-side search to parity with sulcus-local's HNSW capabilities.
--
-- Prerequisites: pgvector extension (already in Azure PG allowlist).
-- Migration is idempotent — safe to re-run.

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 1: Add a pgvector column alongside the old BYTEA column.
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS embedding vector(384);

-- Step 2: Also add to server_ops for sync replay consistency.
ALTER TABLE server_ops ADD COLUMN IF NOT EXISTS embedding vector(384);

-- Step 3: Create HNSW index for cosine similarity search.
-- m=16, ef_construction=200 matches sulcus-local's HNSW params.
CREATE INDEX IF NOT EXISTS idx_golden_index_embedding_hnsw
    ON golden_index
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);

-- Step 4: Partial index for tenant queries filtering on non-null embeddings.
CREATE INDEX IF NOT EXISTS idx_golden_index_tenant_has_embedding
    ON golden_index (tenant_id)
    WHERE embedding IS NOT NULL;

-- Note: Backfill of existing BYTEA→vector is done in Rust (db.rs) at startup,
-- because PostgreSQL lacks native IEEE 754 little-endian float decoding.
-- The Rust backfill reads BYTEA, decodes f32 LE, and writes to the embedding column.
-- Old BYTEA 'vector' columns are kept for backward compat with older sync clients.
