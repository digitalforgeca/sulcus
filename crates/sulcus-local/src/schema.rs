//! SQLite schema definition and migrations for Sulcus local storage.

use rusqlite::Connection;
use anyhow::Result;

/// Current schema version.
pub const SCHEMA_VERSION: u32 = 1;

/// Initialize the database schema. Idempotent — safe to call on every open.
pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch("PRAGMA busy_timeout = 5000;")?;

    // Schema version tracking
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL
        );"
    )?;

    let version: Option<u32> = conn
        .query_row(
            "SELECT version FROM schema_version LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    if version.is_none() {
        create_v1(conn)?;
        conn.execute("INSERT INTO schema_version (version) VALUES (?1)", [SCHEMA_VERSION])?;
    }

    Ok(())
}

/// Create the v1 schema from scratch.
fn create_v1(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        -- Core memory nodes
        CREATE TABLE IF NOT EXISTS memories (
            id              TEXT PRIMARY KEY,
            content         TEXT NOT NULL,
            pointer_summary TEXT,
            memory_type     TEXT NOT NULL DEFAULT 'semantic',
            namespace       TEXT NOT NULL DEFAULT 'default',
            current_heat    REAL NOT NULL DEFAULT 50.0,
            base_utility    REAL NOT NULL DEFAULT 50.0,
            is_pinned       INTEGER NOT NULL DEFAULT 0,
            source          TEXT,
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        -- FTS5 full-text search index over content + pointer_summary
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            content,
            pointer_summary,
            content='memories',
            content_rowid='rowid'
        );

        -- Triggers to keep FTS index in sync
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_fts(rowid, content, pointer_summary)
            VALUES (new.rowid, new.content, new.pointer_summary);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, content, pointer_summary)
            VALUES ('delete', old.rowid, old.content, old.pointer_summary);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, content, pointer_summary)
            VALUES ('delete', old.rowid, old.content, old.pointer_summary);
            INSERT INTO memories_fts(rowid, content, pointer_summary)
            VALUES (new.rowid, new.content, new.pointer_summary);
        END;

        -- Knowledge graph edges
        CREATE TABLE IF NOT EXISTS edges (
            id          TEXT PRIMARY KEY,
            source_id   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            target_id   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            relation    TEXT NOT NULL,
            weight      REAL NOT NULL DEFAULT 1.0,
            created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            UNIQUE(source_id, target_id, relation)
        );

        -- Reactive triggers
        CREATE TABLE IF NOT EXISTS triggers (
            id                  TEXT PRIMARY KEY,
            name                TEXT,
            event               TEXT NOT NULL,
            action              TEXT NOT NULL,
            filter_memory_type  TEXT,
            filter_namespace    TEXT,
            filter_label_pattern TEXT,
            created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        -- Optional vector embeddings (f32 blob)
        -- Populated by Task 4.3 (fastembed integration)
        CREATE TABLE IF NOT EXISTS embeddings (
            memory_id   TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
            vector      BLOB NOT NULL,
            model       TEXT NOT NULL DEFAULT 'bge-small-en-v1.5',
            dimensions  INTEGER NOT NULL DEFAULT 384,
            created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        -- Indexes for common queries
        CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
        CREATE INDEX IF NOT EXISTS idx_memories_heat ON memories(current_heat DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories(is_pinned) WHERE is_pinned = 1;
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
        "
    )?;

    tracing::info!("Initialized Sulcus local database (schema v{SCHEMA_VERSION})");
    Ok(())
}
