-- Add raw_content column to golden_index for verbatim storage.
-- pointer_summary remains as the display/compressed text.
-- raw_content stores the original uncompressed content for embedding and search.
-- Backfill from pointer_summary for existing rows, then rebuild search_vector.
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS raw_content TEXT;
UPDATE golden_index SET raw_content = pointer_summary WHERE raw_content IS NULL;
UPDATE golden_index SET search_vector = to_tsvector('english', COALESCE(raw_content, pointer_summary, ''));
