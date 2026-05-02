-- Full-text search GIN index on golden_index.pointer_summary
-- Used as fallback when semantic (vector) search is unavailable.
-- GIN indexes are fast for @@ (tsvector match) queries.
CREATE INDEX IF NOT EXISTS idx_golden_index_fts
  ON golden_index
  USING gin (to_tsvector('english', COALESCE(pointer_summary, '')));
