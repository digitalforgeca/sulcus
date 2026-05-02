-- Allow multiple API keys per tenant (key rotation, per-agent keys).
-- The old unique index prevented creating a second key for the same tenant.
DROP INDEX IF EXISTS idx_api_keys_tenant_id;
CREATE INDEX idx_api_keys_tenant_id ON api_keys (tenant_id);
