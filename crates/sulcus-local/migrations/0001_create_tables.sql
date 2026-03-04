
CREATE EXTENSION IF NOT EXISTS vector;

BEGIN;

CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS folds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    folded_at BIGINT,
    FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS page_embeddings (
    page_id TEXT PRIMARY KEY,
    vector BYTEA NOT NULL,
    FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pages_fts
    ON pages USING GIN (to_tsvector('english', content));

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    pointer_summary TEXT NOT NULL DEFAULT '',
    base_utility REAL NOT NULL DEFAULT 0.0,
    current_heat REAL NOT NULL DEFAULT 0.0,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    memory_type TEXT NOT NULL DEFAULT 'episodic',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    folded_at TEXT,
    crdt_clocks JSONB
);

CREATE TABLE IF NOT EXISTS edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'semantic',
    edge_weight REAL NOT NULL DEFAULT 0.5,
    valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_to TEXT,
    PRIMARY KEY(source_id, target_id),
    FOREIGN KEY(source_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(target_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payloads (
    node_id TEXT PRIMARY KEY,
    raw_content TEXT NOT NULL,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings (
    node_id TEXT PRIMARY KEY,
    vector BYTEA NOT NULL,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS node_folds (
    node_id TEXT NOT NULL,
    fold_id TEXT NOT NULL,
    PRIMARY KEY(node_id, fold_id),
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(fold_id) REFERENCES folds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS active_index (
    node_id TEXT PRIMARY KEY,
    heat REAL NOT NULL DEFAULT 0.0,
    consecutive_active_ticks INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cold_storage (
    node_id TEXT PRIMARY KEY,
    compressed_content TEXT NOT NULL,
    fold_summary TEXT NOT NULL,
    folded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tombstones (
    node_id TEXT PRIMARY KEY,
    label TEXT,
    address TEXT,
    evicted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS client_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS memory_ops (
    seq BIGSERIAL PRIMARY KEY,
    op_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE memory_ops ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_nodes_heat ON nodes(current_heat DESC);
CREATE INDEX IF NOT EXISTS idx_active_heat ON active_index(heat DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_fts ON nodes USING GIN (to_tsvector('english', pointer_summary));
CREATE INDEX IF NOT EXISTS idx_memory_ops_status ON memory_ops(status);
CREATE INDEX IF NOT EXISTS idx_edges_valid_to ON edges(valid_to);

COMMIT;
-- UNIQUE_STAMP_123456
