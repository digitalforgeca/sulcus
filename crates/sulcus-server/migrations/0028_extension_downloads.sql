-- 0028_extension_downloads.sql
-- Track sulcus-sync dylib deliveries per API key.
-- Logs every encrypted download for auditing and rate-limiting.

CREATE TABLE IF NOT EXISTS extension_downloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_id UUID NOT NULL,
    platform TEXT NOT NULL,
    version TEXT NOT NULL,
    downloaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extension_downloads_key_id ON extension_downloads(key_id);
