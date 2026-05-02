-- 0046: Add optional namespace column to api_keys.
-- When set, this overrides the key label for namespace resolution.
-- This decouples the human-readable key label (e.g. "Daedalus-cloud")
-- from the agent's memory namespace (e.g. "daedalus").
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS namespace TEXT DEFAULT NULL;
