-- 0017_normalize_plan_tiers.sql
-- Canonical plan_tier values are: 'free', 'cortex', 'enterprise'.
--
-- Previous versions of the JIT provisioning code wrote legacy aliases:
--   'starter' — old default for free users (now 'free')
--   'team'    — old alias for the mid tier (now 'cortex')
--   'pro'     — placeholder that was never activated (now 'free')
--
-- This migration is idempotent: running it multiple times is safe.
UPDATE api_keys SET plan_tier = 'free'    WHERE plan_tier IN ('starter', 'pro');
UPDATE api_keys SET plan_tier = 'cortex'  WHERE plan_tier = 'team';
