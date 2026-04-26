-- Migration 0050: Add temporal validity to graph edges (Zep/Graphiti parity)
--
-- Every fact has a time window: when it became true and when it stopped being true.
-- "Sarah works at Google" valid_from=2020 valid_until=2024
-- "Sarah works at Meta" valid_from=2024 valid_until=NULL (current)
--
-- valid_from: when this relationship became true (NULL = unknown/always)
-- valid_until: when this relationship stopped being true (NULL = still current)

-- Add temporal columns to golden_edges
ALTER TABLE golden_edges ADD COLUMN IF NOT EXISTS valid_from timestamptz;
ALTER TABLE golden_edges ADD COLUMN IF NOT EXISTS valid_until timestamptz;

-- Add temporal columns to the extracted triples struct
-- (The SILU prompt now asks for optional valid_from/valid_until)

-- Index for temporal queries: find edges valid at a specific point in time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_golden_edges_temporal
ON golden_edges (tenant_id, valid_from, valid_until)
WHERE valid_from IS NOT NULL OR valid_until IS NOT NULL;

-- Helper: find all edges valid at a given timestamp
-- Usage: SELECT * FROM golden_edges
--        WHERE tenant_id = $1
--        AND (valid_from IS NULL OR valid_from <= $2)
--        AND (valid_until IS NULL OR valid_until > $2)
