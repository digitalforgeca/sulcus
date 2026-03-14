-- 0002_api_keys.sql
-- Add API keys table for multi-tenant authentication and plan tracking

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(64) NOT NULL UNIQUE,
    key_hash TEXT NOT NULL, -- SHA256 hex hash of the secret key
    plan_tier TEXT NOT NULL DEFAULT 'free', -- 'free', 'pro', 'enterprise'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DELETE FROM api_keys a USING api_keys b WHERE a.ctid < b.ctid AND a.tenant_id = b.tenant_id;
DROP INDEX IF EXISTS idx_api_keys_tenant_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

-- Add vector column to golden_index for semantic search support
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS vector BYTEA;
