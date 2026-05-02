-- 0008_billing.sql — Stripe billing columns for api_keys
-- Safe to run multiple times. All statements are idempotent.

ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_sub_id       TEXT,
    ADD COLUMN IF NOT EXISTS ops_limit           BIGINT;

-- Index for Stripe webhook lookups (customer_id -> tenant).
CREATE INDEX IF NOT EXISTS idx_api_keys_stripe_customer
    ON api_keys (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;
