-- Migration 0049: Add stored tsvector column + GIN index for parallel BM25 search
--
-- Currently tsvector is computed on-the-fly in queries (slow, no index).
-- This migration:
--   1. Adds a stored `search_vector` column (tsvector)
--   2. Populates it from existing pointer_summary data
--   3. Creates a GIN index for fast full-text search
--   4. Adds a trigger to auto-update on INSERT/UPDATE
--
-- After this migration, search queries can use the pre-computed column
-- instead of to_tsvector() in WHERE clauses, enabling index-backed FTS.

-- Step 1: Add the column
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Step 2: Populate from existing data
UPDATE golden_index
SET search_vector = to_tsvector('english', COALESCE(pointer_summary, ''))
WHERE search_vector IS NULL;

-- Step 3: Create GIN index (concurrent to avoid locking)
CREATE INDEX IF NOT EXISTS idx_golden_index_search_vector
ON golden_index USING GIN (search_vector);

-- Step 4: Auto-update trigger
CREATE OR REPLACE FUNCTION golden_index_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.pointer_summary, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_golden_index_search_vector ON golden_index;
CREATE TRIGGER trg_golden_index_search_vector
  BEFORE INSERT OR UPDATE OF pointer_summary ON golden_index
  FOR EACH ROW
  EXECUTE FUNCTION golden_index_search_vector_update();

-- Step 5: Add fts_weight to thermo_config recall section (for tenants using JSON config)
-- This is informational — the Rust default handles it. No schema change needed.
-- New field: recall.fts_weight (default 0.25) — weight for FTS ts_rank in parallel scoring.
