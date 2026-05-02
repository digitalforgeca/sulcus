-- 0041_entities.sql
-- Entity table for LLM-extracted entities from memory content.
-- Entities are linked to their source memories via golden_edges.

CREATE TABLE IF NOT EXISTS entities (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   VARCHAR(64) NOT NULL,
    namespace   VARCHAR(64) NOT NULL DEFAULT 'default',
    name        TEXT        NOT NULL,
    entity_type TEXT        NOT NULL DEFAULT 'concept',
    summary     TEXT,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    mention_count INTEGER   NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, namespace, name, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_entities_tenant_ns ON entities (tenant_id, namespace);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities (tenant_id, name);

-- Track which memory a relationship was extracted from (provenance).
ALTER TABLE golden_edges ADD COLUMN IF NOT EXISTS source_memory_id UUID;
ALTER TABLE golden_edges ADD COLUMN IF NOT EXISTS relationship_label TEXT;
ALTER TABLE golden_edges ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;

-- Mark edges that came from LLM extraction vs temporal proximity heuristic
-- edge_type = 'temporal_proximity' (existing) | 'extracted' (new LLM-based)
