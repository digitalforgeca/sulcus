-- 0027_memory_lock.sql
-- Add is_locked column to golden_index.
-- Locked memories cannot be deleted or modified by the LLM — only by the user.
-- Separate from is_pinned (pin = no decay, lock = no modify/delete).

ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;
