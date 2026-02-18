-- 0001_create_tables.sql

-- Nodes: the semantic map (pointer-only metadata)
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    pointer_summary TEXT NOT NULL,
    base_utility REAL DEFAULT 0.0,
    current_heat REAL DEFAULT 0.0,
    is_pinned INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nodes_current_heat ON nodes(current_heat DESC);

-- Payloads: the pristine territory (raw, never summarized)
CREATE TABLE IF NOT EXISTS payloads (
    node_id TEXT PRIMARY KEY,
    raw_content TEXT NOT NULL,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Edges: graph topology used by the thermodynamics CTE
CREATE TABLE IF NOT EXISTS edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    edge_weight REAL DEFAULT 0.5,
    PRIMARY KEY (source_id, target_id),
    FOREIGN KEY(source_id) REFERENCES nodes(id),
    FOREIGN KEY(target_id) REFERENCES nodes(id)
);

-- Vector index (vec_nodes) is created at runtime when the `sqlite-vec` extension
-- is available. We intentionally **do not** create the virtual table in the
-- static migration to keep unit tests and environments without the native
-- extension working reliably.

-- Embeddings: raw float32 vectors stored as byte BLOBs (bytemuck-safe)
CREATE TABLE IF NOT EXISTS embeddings (
    node_id TEXT PRIMARY KEY,
    vector BLOB NOT NULL,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Folds: named namespaces (context packages)
CREATE TABLE IF NOT EXISTS folds (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

-- Node <> Fold membership
CREATE TABLE IF NOT EXISTS node_folds (
    node_id TEXT NOT NULL,
    fold_id TEXT NOT NULL,
    PRIMARY KEY (node_id, fold_id),
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(fold_id) REFERENCES folds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS active_index (
    node_id TEXT PRIMARY KEY,
    heat REAL NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- client_meta table removed (continuous WAL / client-side sync deprecated; use folds + explicit export/import)
