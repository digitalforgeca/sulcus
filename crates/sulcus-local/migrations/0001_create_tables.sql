-- 0001_create_tables.sql

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    heat REAL NOT NULL DEFAULT 0.0,
    vector BLOB,
    payload_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nodes_heat ON nodes(heat DESC);

CREATE TABLE IF NOT EXISTS edges (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    weight REAL NOT NULL,
    edge_type TEXT NOT NULL,
    PRIMARY KEY (source, target)
);

CREATE TABLE IF NOT EXISTS memory_ops (
    seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
    op_type TEXT NOT NULL,
    payload JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS active_index (
    node_id TEXT PRIMARY KEY,
    heat REAL NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- key/value store for client-side sync metadata (server cursor, last_seq, etc.)
CREATE TABLE IF NOT EXISTS client_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
