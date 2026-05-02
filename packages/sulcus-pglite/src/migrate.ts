/**
 * sulcus-pglite — SQL migrations
 *
 * Two migration schemas are embedded here:
 *
 *  LOCAL  – the full sulcus vMMU + node graph schema (used when running
 *            PGlite as the local MCP backend for an individual agent).
 *
 *  BROWSER – a simplified schema for purely client-side memory storage.
 *
 * Migration runner logic handles one-by-one statement execution to bypass
 * PGlite batching limitations.
 */

/** The full SULCUS schema (Postgres dialect). */
export const LOCAL_MIGRATION = `
-- 0001_create_tables.sql
-- Full SULCUS schema (PostgreSQL): vMMU (Spaces/Pages/PageTables) + Node Graph
--   + Async-Fold cold storage + Tombstones for eviction pointers
-- PGlite-compatible: no PRAGMA, BYTEA for blobs, BIGSERIAL for auto-inc

-- Enable pgvector if available. In test environments (pg-embed) this may fail; 
-- the migration runner should ignore this specific error.
CREATE EXTENSION IF NOT EXISTS vector;

-- Physical partitioning: Spaces hold immutable Pages.
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

-- Page embeddings stored as native vectors (fallback to BYTEA if extension missing)
CREATE TABLE IF NOT EXISTS page_embeddings (
    page_id TEXT PRIMARY KEY,
    vector BYTEA NOT NULL,
    FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

-- GIN index for full-text search on pages.content (replaces FTS5 virtual table)
CREATE INDEX IF NOT EXISTS idx_pages_fts
    ON pages USING GIN (to_tsvector('english', content));

-- Node Graph: The primary memory representation.
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

-- Territory: Full verbatim content for nodes (loaded on page-fault).
CREATE TABLE IF NOT EXISTS payloads (
    node_id TEXT PRIMARY KEY,
    raw_content TEXT NOT NULL,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Node embeddings stored as native vectors (fallback to BYTEA)
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

-- Hot-node index rebuilt on every thermodynamics tick
CREATE TABLE IF NOT EXISTS active_index (
    node_id TEXT PRIMARY KEY,
    heat REAL NOT NULL DEFAULT 0.0,
    consecutive_active_ticks INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Cold storage: Condensed memories + verbatim backup for recall.
CREATE TABLE IF NOT EXISTS cold_storage (
    node_id TEXT PRIMARY KEY,
    compressed_content TEXT NOT NULL,
    fold_summary TEXT NOT NULL,
    folded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Tombstones for evicted nodes (active index pointers).
CREATE TABLE IF NOT EXISTS tombstones (
    node_id TEXT PRIMARY KEY,
    label TEXT,
    address TEXT,
    evicted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Metadata for sync / multi-agent coordination.
CREATE TABLE IF NOT EXISTS client_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Write-Ahead Log (WAL) for memory operations.
CREATE TABLE IF NOT EXISTS memory_ops (
    seq BIGSERIAL PRIMARY KEY,
    op_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nodes_heat ON nodes(current_heat DESC);
CREATE INDEX IF NOT EXISTS idx_active_heat ON active_index(heat DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_fts ON nodes USING GIN (to_tsvector('english', pointer_summary));
CREATE INDEX IF NOT EXISTS idx_memory_ops_status ON memory_ops(status);
CREATE INDEX IF NOT EXISTS idx_edges_valid_to ON edges(valid_to);
`;

/** Simple browser-only schema. */
export const BROWSER_MIGRATION = LOCAL_MIGRATION;

/**
 * Migration runner. Executes each semicolon-terminated statement individually.
 * This ensures that skippable failures (like CREATE EXTENSION) don't abort
 * the entire schema setup.
 */
export async function runMigrations(db: any, migration: string) {
  try {
    // Attempt full execution first (faster)
    await db.exec(migration);
  } catch (err) {
    // If full execution fails (likely due to pgvector extension missing), 
    // run statement-by-statement and swallow known errors.
    const statements = migration
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const sql of statements) {
      try {
        await db.exec(sql + ";");
      } catch (e: any) {
        const msg = e.message || "";
        if (
          msg.includes("extension \"vector\" is not available") ||
          msg.includes("already exists") ||
          msg.includes("language \"plpgsql\" already exists")
        ) {
          continue;
        }
        throw e;
      }
    }
  }
}
