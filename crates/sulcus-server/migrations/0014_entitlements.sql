-- 0014_entitlements.sql — Stripe product metadata → tenant entitlements
-- NULL means unlimited (no limit enforced).
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS max_agents BIGINT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS max_sync_requests BIGINT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS max_nodes BIGINT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS features TEXT DEFAULT '';
