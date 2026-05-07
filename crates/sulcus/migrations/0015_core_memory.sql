-- Core Memory: persistent identity block always injected into agent context
CREATE TABLE IF NOT EXISTS core_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace TEXT NOT NULL DEFAULT 'default',
  identity TEXT DEFAULT '',
  relationships TEXT DEFAULT '',
  preferences TEXT DEFAULT '',
  current_focus TEXT DEFAULT '',
  custom JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (namespace)
);
