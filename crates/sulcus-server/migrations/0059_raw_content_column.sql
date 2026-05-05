-- Add raw_content column to golden_index for verbatim storage.
-- pointer_summary remains as the display/compressed text.
-- raw_content stores the original uncompressed content for embedding and search.
-- Backfill and search_vector rebuild happen in background task after startup (0060).
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS raw_content TEXT;
