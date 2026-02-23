-- 0001_create_tables.sql
-- Full SULCUS schema (PostgreSQL): vMMU (Spaces/Pages/PageTables) + Node Graph
--   + Async-Fold cold storage + Tombstones for eviction pointers
-- PGlite-compatible: no PRAGMA, BYTEA for blobs, BIGSERIAL for auto-increment,
-- GIN-indexed tsvector for full-text search.

BEGIN;

-- ── vMMU layer: Spaces, Pages, PageTables ───────────────────────────────────

-- Spaces: physical namespaces that can be mounted/exported
CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at BIGINT NOT NULL
);

-- Pages: immutable territory chunks (token-aware)
-- `folded_at` is non-null when the page has been condensed by async folding.
CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    folded_at BIGINT,
    FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

-- Page embeddings stored as BYTEA (float32 bytes, little-endian)
CREATE TABLE IF NOT EXISTS page_embeddings (
    page_id TEXT PRIMARY KEY,
    vector BYTEA NOT NULL,
    FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

-- GIN index for full-text search on pages.content (replaces FTS5 virtual table)
CREATE INDEX IF NOT EXISTS idx_pages_fts
    ON pages USING GIN (to_tsvector('english', content));

-- PageTables: per-session attention / heat tracking (virtual memory table)
CREATE TABLE IF NOT EXISTS page_tables (
    session_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    heat FLOAT4 NOT NULL,
    accessed_at BIGINT NOT NULL,
    PRIMARY KEY(session_id, page_id),
    FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

-- ── Node Graph layer: lightweight "Map" pointers ────────────────────────────
-- These are the semantic node pointers the LLM scans. Heavy content lives in
-- `payloads` (warm) or `cold_storage` (cold, post-fold).

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    pointer_summary TEXT NOT NULL DEFAULT '',
    base_utility FLOAT4 NOT NULL DEFAULT 0.0,
    current_heat FLOAT4 NOT NULL DEFAULT 0.0,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    memory_type TEXT NOT NULL DEFAULT 'episodic'
        CHECK(memory_type IN ('episodic', 'semantic', 'preference', 'procedural')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    folded_at TEXT
);

-- GIN index for full-text search on nodes.pointer_summary
CREATE INDEX IF NOT EXISTS idx_nodes_fts
    ON nodes USING GIN (to_tsvector('english', pointer_summary));

-- Directed semantic edges between nodes (knowledge graph)
CREATE TABLE IF NOT EXISTS edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'semantic',
    edge_weight FLOAT4 NOT NULL DEFAULT 0.5,
    valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_to TEXT,
    PRIMARY KEY(source_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_edges_valid_to ON edges(valid_to);

-- Warm territory: verbose raw content attached to nodes
CREATE TABLE IF NOT EXISTS payloads (
    node_id TEXT PRIMARY KEY,
    raw_content TEXT NOT NULL
);

-- Node embeddings stored as BYTEA (float32, little-endian)
CREATE TABLE IF NOT EXISTS embeddings (
    node_id TEXT PRIMARY KEY,
    vector BYTEA NOT NULL
);

-- Hot-node index rebuilt on every thermodynamics tick
CREATE TABLE IF NOT EXISTS active_index (
    node_id TEXT PRIMARY KEY,
    heat FLOAT4 NOT NULL,
    consecutive_active_ticks INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Named working sets (folds) for scoped context switching
CREATE TABLE IF NOT EXISTS folds (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS node_folds (
    node_id TEXT NOT NULL,
    fold_id TEXT NOT NULL,
    PRIMARY KEY(node_id, fold_id)
);

-- ── Cold storage: post-fold condensed content ───────────────────────────────
CREATE TABLE IF NOT EXISTS cold_storage (
    node_id TEXT PRIMARY KEY,
    compressed_content TEXT NOT NULL,
    fold_summary TEXT NOT NULL,
    folded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Tombstones: eviction pointers left in context window ────────────────────
CREATE TABLE IF NOT EXISTS tombstones (
    session_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    evicted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(session_id, page_id)
);

-- ── WAL for sync: records ops to push to server ─────────────────────────────
CREATE TABLE IF NOT EXISTS memory_ops (
    seq BIGSERIAL PRIMARY KEY,
    op_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memory_ops_status ON memory_ops(status);

COMMIT;
