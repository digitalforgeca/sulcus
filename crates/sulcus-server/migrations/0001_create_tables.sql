-- Create Golden Index and server WAL for SULCUS server

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS golden_index (
    id UUID PRIMARY KEY,
    summary TEXT NOT NULL,
    heat REAL NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS server_ops (
    seq_id BIGSERIAL PRIMARY KEY,
    op_type TEXT NOT NULL,
    payload JSONB,
    op_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- unique fingerprint to make the server WAL idempotent for duplicate client ops
CREATE UNIQUE INDEX IF NOT EXISTS ux_server_ops_op_hash ON server_ops(op_hash);

CREATE INDEX IF NOT EXISTS idx_server_ops_created_at ON server_ops(created_at);
