-- Create Golden Index and server WAL for SULCUS server

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Golden index: authoritative view of latest nodes on the server
CREATE TABLE IF NOT EXISTS golden_index (
    id UUID PRIMARY KEY,
    pointer_summary TEXT NOT NULL,
    base_utility REAL DEFAULT 0.0,
    current_heat REAL NOT NULL,
    is_pinned BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server WAL (append-only). op_hash is a deterministic fingerprint and MUST be present
-- so the DB can enforce idempotency at the constraint/index level.
CREATE TABLE IF NOT EXISTS server_ops (
    seq_id BIGSERIAL PRIMARY KEY,
    op_type TEXT NOT NULL CHECK (op_type IN ('Add','Update','Delete')),
    payload JSONB,
    op_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- unique fingerprint to make the server WAL idempotent for duplicate client ops
CREATE UNIQUE INDEX IF NOT EXISTS ux_server_ops_op_hash ON server_ops(op_hash);

CREATE INDEX IF NOT EXISTS idx_server_ops_created_at ON server_ops(created_at);

-- index to accelerate "hot node" queries (order by current_heat, updated_at)
CREATE INDEX IF NOT EXISTS idx_golden_index_current_heat_updated_at ON golden_index (current_heat DESC, updated_at DESC);
