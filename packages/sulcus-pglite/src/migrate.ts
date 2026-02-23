/**
 * sulcus-pglite — SQL migrations
 *
 * Two migration schemas are embedded here:
 *
 *  LOCAL  – the full sulcus-local vMMU + node graph schema (used when running
 *            PGlite as the local MCP backend for an individual agent or web app).
 *
 *  SERVER – the golden-index + server WAL schema (used when running PGlite as
 *            the sync server backend instead of real Postgres).
 *
 * Migrations are idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
 */

import type { PGlite } from "@electric-sql/pglite";

// ---------------------------------------------------------------------------
// Local schema — mirrors crates/sulcus-local/migrations/
// ---------------------------------------------------------------------------

const LOCAL_MIGRATIONS = [
  // 0001_create_tables
  `
CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at BIGINT NOT NULL
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

CREATE TABLE IF NOT EXISTS page_tables (
    session_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    heat FLOAT4 NOT NULL,
    accessed_at BIGINT NOT NULL,
    PRIMARY KEY(session_id, page_id),
    FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

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

CREATE INDEX IF NOT EXISTS idx_nodes_fts
    ON nodes USING GIN (to_tsvector('english', pointer_summary));

CREATE TABLE IF NOT EXISTS edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'semantic',
    edge_weight FLOAT4 NOT NULL DEFAULT 0.5,
    valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_to TEXT,
    PRIMARY KEY(source_id, target_id)
);

CREATE TABLE IF NOT EXISTS payloads (
    node_id TEXT PRIMARY KEY,
    raw_content TEXT,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cold_storage (
    node_id TEXT PRIMARY KEY,
    compressed_content TEXT NOT NULL,
    fold_summary TEXT NOT NULL,
    folded_at TEXT NOT NULL,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings (
    node_id TEXT PRIMARY KEY,
    vector BYTEA NOT NULL,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tombstones (
    node_id TEXT PRIMARY KEY,
    evicted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS active_index (
    node_id TEXT PRIMARY KEY,
    heat FLOAT4 NOT NULL,
    consecutive_active_ticks INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_ops (
    seq BIGSERIAL PRIMARY KEY,
    op_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    synced_at TEXT,
    op_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_memory_ops_synced_at ON memory_ops(synced_at);

CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folds (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS node_folds (
    node_id TEXT NOT NULL,
    fold_id TEXT NOT NULL,
    PRIMARY KEY(node_id, fold_id),
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(fold_id) REFERENCES folds(id) ON DELETE CASCADE
);
`,
  // 0002_typed_memories
  `
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS memory_type_new TEXT;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS source_agent TEXT;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS confidence FLOAT4;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS last_accessed_at TEXT;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE payloads ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE payloads ADD COLUMN IF NOT EXISTS byte_size INTEGER;
CREATE INDEX IF NOT EXISTS idx_nodes_memory_type ON nodes(memory_type);
CREATE INDEX IF NOT EXISTS idx_nodes_current_heat ON nodes(current_heat DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_is_pinned ON nodes(is_pinned) WHERE is_pinned = TRUE;
`,
];

// ---------------------------------------------------------------------------
// Server schema — mirrors crates/sulcus-server/migrations/
// ---------------------------------------------------------------------------

const SERVER_MIGRATIONS = [
  `
CREATE TABLE IF NOT EXISTS golden_index (
    tenant_id VARCHAR(64) NOT NULL,
    id UUID NOT NULL,
    pointer_summary TEXT NOT NULL,
    base_utility REAL DEFAULT 0.0,
    current_heat REAL NOT NULL,
    is_pinned BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS server_ops (
    seq_id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    op_type TEXT NOT NULL CHECK (op_type IN ('Add','Update','Delete')),
    payload JSONB,
    op_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_server_ops_tenant_hash ON server_ops(tenant_id, op_hash);
CREATE INDEX IF NOT EXISTS idx_server_ops_created_at ON server_ops(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_golden_index_current_heat_updated_at
    ON golden_index (tenant_id, current_heat DESC, updated_at DESC);
`,
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type MigrationTarget = "local" | "server";

/**
 * Run all migrations for the given target against a PGlite instance.
 * Each statement is executed individually so one failure surfaces clearly.
 * All statements are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 */
export async function runMigrations(
  db: PGlite,
  target: MigrationTarget = "local",
): Promise<void> {
  const migrations = target === "server" ? SERVER_MIGRATIONS : LOCAL_MIGRATIONS;

  for (const migration of migrations) {
    // Split on semicolons, filter empty statements, run one-by-one
    const statements = migration
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const sql of statements) {
      await db.exec(sql + ";");
    }
  }
}
