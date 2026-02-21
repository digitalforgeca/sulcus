-- 0001_create_tables.sql
-- Full SULCUS schema: vMMU (Spaces/Pages/PageTables) + Node Graph (Map layer)
--   + Async-Fold cold storage + Tombstones for eviction pointers

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

-- ── vMMU layer: Spaces, Pages, PageTables ───────────────────────────────────

-- Spaces: physical namespaces that can be mounted/exported
CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
);

-- Pages: immutable territory chunks (token-aware)
-- `folded_at` is non-null when the page has been condensed by async folding;
-- raw_content has been moved to cold_storage.
CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    folded_at INTEGER,                      -- NULL = warm / not yet folded
    FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

-- Page embeddings stored as raw BLOBs (float32 bytes, little-endian)
CREATE TABLE IF NOT EXISTS page_embeddings (
    page_id TEXT PRIMARY KEY,
    vector BLOB NOT NULL,
    FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

-- PageTables: per-session attention / heat tracking (virtual memory table)
CREATE TABLE IF NOT EXISTS page_tables (
    session_id TEXT,
    page_id TEXT,
    heat REAL NOT NULL,
    accessed_at INTEGER NOT NULL,
    PRIMARY KEY(session_id, page_id),
    FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

-- FTS5 virtual table for keyword search against `pages.content`
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(page_id UNINDEXED, content);

-- ── Node Graph layer: lightweight "Map" pointers ────────────────────────────
-- These are the semantic node pointers the LLM scans. Heavy content lives in
-- `payloads` (warm) or `cold_storage` (cold, post-fold).

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    pointer_summary TEXT NOT NULL DEFAULT '',
    base_utility REAL NOT NULL DEFAULT 0.0,
    current_heat REAL NOT NULL DEFAULT 0.0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Set when async folding condenses this node; raw payload moves to cold_storage
    folded_at TEXT
);

-- Directed semantic edges between nodes (knowledge graph)
CREATE TABLE IF NOT EXISTS edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'semantic',
    edge_weight REAL NOT NULL DEFAULT 0.5,
    PRIMARY KEY(source_id, target_id)
);

-- Warm territory: verbose raw content attached to nodes
CREATE TABLE IF NOT EXISTS payloads (
    node_id TEXT PRIMARY KEY,
    raw_content TEXT NOT NULL
);

-- Node embeddings stored as raw BLOBs (float32, little-endian)
CREATE TABLE IF NOT EXISTS embeddings (
    node_id TEXT PRIMARY KEY,
    vector BLOB NOT NULL
);

-- Hot-node index rebuilt on every thermodynamics tick
CREATE TABLE IF NOT EXISTS active_index (
    node_id TEXT PRIMARY KEY,
    heat REAL NOT NULL,
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
-- When a node's episodic memory pages cool down, the async fold compresses the
-- raw content here. The warm `payloads` row is deleted; the dense fold summary
-- lives in `nodes.pointer_summary`. This table holds the archived verbatim text
-- for on-demand page-in ("page fault").

CREATE TABLE IF NOT EXISTS cold_storage (
    node_id TEXT PRIMARY KEY,
    compressed_content TEXT NOT NULL,   -- verbatim raw content (pre-fold)
    fold_summary TEXT NOT NULL,         -- the dense extractive summary
    folded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Tombstones: eviction pointers left in context window ────────────────────
-- When the LRU eviction kills a page from a session's page_tables, a tombstone
-- is written here. The LLM sees these as pointer stubs:
--   "[Paged Out: 0x4A2F User's database preferences]"
-- If it identifies it needs the details it can issue a `fetch_payload` with the
-- address to bring the page back in.

CREATE TABLE IF NOT EXISTS tombstones (
    session_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    -- Human-readable address hint, e.g. "[Paged Out: 0x4A2F label]"
    address TEXT NOT NULL DEFAULT '',
    evicted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(session_id, page_id)
);

-- Write-ahead log for sync: records ops that need to be pushed to the server.
-- Entries are marked 'pending' until successfully pushed, then 'synced'.
CREATE TABLE IF NOT EXISTS memory_ops (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
