-- 0007_golden_edges.sql
-- Add golden edges table for global knowledge graph relationships

CREATE TABLE IF NOT EXISTS golden_edges (
    tenant_id  VARCHAR(64) NOT NULL,
    source_id  UUID        NOT NULL,
    target_id  UUID        NOT NULL,
    weight     REAL        NOT NULL DEFAULT 1.0,
    edge_type  TEXT        NOT NULL DEFAULT 'related',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, source_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_golden_edges_source ON golden_edges (tenant_id, source_id);
CREATE INDEX IF NOT EXISTS idx_golden_edges_target ON golden_edges (tenant_id, target_id);
