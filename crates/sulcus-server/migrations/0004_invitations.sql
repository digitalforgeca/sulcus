-- 0004_invitations.sql
-- Add invitations system for agent fleet onboarding

CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(64) NOT NULL,
    token_hash TEXT NOT NULL UNIQUE, -- SHA256 hex hash of the invitation token
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON invitations(token_hash);

-- Drop the old unique constraint on tenant_id in api_keys to allow multiple keys per tenant
-- (Agent fleets sharing a single memory pool)
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_tenant_id_key;
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys(tenant_id);

-- Add memory_type to golden_index
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'episodic';
