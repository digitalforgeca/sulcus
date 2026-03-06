ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS max_seats INTEGER DEFAULT 1;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS seats_used INTEGER DEFAULT 1;

-- Add a display name for the organization/tenant
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS org_name TEXT;
