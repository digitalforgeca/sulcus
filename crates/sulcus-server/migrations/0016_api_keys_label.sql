-- Add label and last_used_at to api_keys for key management dashboard
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS label TEXT DEFAULT '';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
