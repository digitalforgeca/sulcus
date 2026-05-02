-- 0012_memory_lock.sql
-- Add is_locked column to nodes.
-- Locked memories cannot be deleted or modified by the LLM — only by the user.

ALTER TABLE nodes ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;
