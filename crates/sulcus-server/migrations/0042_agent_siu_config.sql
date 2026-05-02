-- Per-agent (namespace) SIU configuration
-- Migrates from global-only siu_config to per-namespace scoping.
-- The old 'global' row becomes the tenant-level default (namespace IS NULL).

-- Add namespace column to siu_config (nullable = tenant-wide default)
ALTER TABLE siu_config ADD COLUMN IF NOT EXISTS namespace VARCHAR(128);

-- Drop the old single-row PK and add a unique index that handles NULLs
ALTER TABLE siu_config DROP CONSTRAINT IF EXISTS siu_config_pkey;

-- Use a surrogate PK column so we can have a proper unique constraint with NULL handling
ALTER TABLE siu_config ADD COLUMN IF NOT EXISTS id SERIAL;
ALTER TABLE siu_config ADD PRIMARY KEY (id);

-- Unique constraint: one config per tenant + namespace (NULL = global default)
CREATE UNIQUE INDEX IF NOT EXISTS uq_siu_config_tenant_ns
  ON siu_config (tenant_id, COALESCE(namespace, '__global__'));

-- updated_at is handled by the application layer — no trigger needed here
