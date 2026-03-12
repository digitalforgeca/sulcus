-- Fix key_hash index to be UNIQUE (required for ON CONFLICT in JIT provisioning)
DROP INDEX IF EXISTS idx_api_keys_key_hash;
CREATE UNIQUE INDEX idx_api_keys_key_hash ON api_keys (key_hash);
