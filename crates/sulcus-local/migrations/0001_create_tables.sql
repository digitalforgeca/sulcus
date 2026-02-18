-- 0001_create_tables.sql
-- vMMU schema: Spaces, Pages (immutable), Page Embeddings, PageTables (session attention)

PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

-- Drop legacy / conflicting tables if present
DROP TABLE IF EXISTS node_folds;
DROP TABLE IF EXISTS folds;
DROP TABLE IF EXISTS embeddings;
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS payloads;
DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS active_index;
DROP TABLE IF EXISTS pages_fts; -- virtual table

-- Spaces: physical namespaces that can be mounted/exported
CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
);

-- Pages: immutable chunks of territory (token-aware)
CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

-- Page embeddings stored as raw BLOBs (float32 bytes)
CREATE TABLE IF NOT EXISTS page_embeddings (
    page_id TEXT PRIMARY KEY,
    vector BLOB NOT NULL,
    FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

-- PageTables: per-session attention / heat tracking (virtual memory tables)
CREATE TABLE IF NOT EXISTS page_tables (
    session_id TEXT,
    page_id TEXT,
    heat REAL NOT NULL,
    accessed_at INTEGER NOT NULL,
    PRIMARY KEY(session_id, page_id),
    FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

-- FTS5 virtual table for keyword search against `pages.content`
-- Use explicit `page_id` column (rowid cannot be a UUID string).
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(page_id UNINDEXED, content);

COMMIT;