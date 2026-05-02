-- 0009_patch_ops.sql
-- Add support for Patch op types and ensure data fidelity in server_ops

ALTER TABLE server_ops ADD COLUMN IF NOT EXISTS patch JSONB;
ALTER TABLE server_ops ADD COLUMN IF NOT EXISTS raw_content TEXT;
ALTER TABLE server_ops ADD COLUMN IF NOT EXISTS vector BYTEA;
