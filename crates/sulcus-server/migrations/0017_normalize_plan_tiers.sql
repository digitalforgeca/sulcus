-- Normalize plan_tier to canonical values: "free", "cortex", "enterprise"
-- Legacy values: "starter" / "pro" → "free", "team" → "cortex"
UPDATE api_keys SET plan_tier = 'free' WHERE plan_tier IN ('starter', 'pro');
UPDATE api_keys SET plan_tier = 'cortex' WHERE plan_tier = 'team';
