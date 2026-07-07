//! PostgreSQL schema definition and migrations for Sulcus local storage.

use sqlx::PgPool;
use anyhow::Result;

/// Current schema version.
pub const SCHEMA_VERSION: u32 = 1;

/// Initialize the database schema. Idempotent — safe to call on every open.
pub async fn init(pool: &PgPool) -> Result<()> {
    // Schema version tracking
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL
        );"
    )
    .execute(pool)
    .await?;

    let version: Option<i32> = sqlx::query_scalar("SELECT version FROM schema_version LIMIT 1")
        .fetch_optional(pool)
        .await?
        .unwrap_or(None);

    if version.is_none() {
        create_v1(pool).await?;
        sqlx::query("INSERT INTO schema_version (version) VALUES ($1)")
            .bind(SCHEMA_VERSION as i32)
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// Create the v1 schema from scratch.
async fn create_v1(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "
        -- Core memory nodes
        CREATE TABLE IF NOT EXISTS memories (
            id              TEXT PRIMARY KEY,
            content         TEXT NOT NULL,
            pointer_summary TEXT,
            memory_type     TEXT NOT NULL DEFAULT 'semantic',
            namespace       TEXT NOT NULL DEFAULT 'default',
            current_heat    DOUBLE PRECISION NOT NULL DEFAULT 50.0,
            base_utility    DOUBLE PRECISION NOT NULL DEFAULT 50.0,
            is_pinned       INTEGER NOT NULL DEFAULT 0,
            source          TEXT,
            created_at      TEXT NOT NULL DEFAULT TO_CHAR(timezone('utc', now()), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
            updated_at      TEXT NOT NULL DEFAULT TO_CHAR(timezone('utc', now()), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
        );

        -- Knowledge graph edges
        CREATE TABLE IF NOT EXISTS edges (
            id          TEXT PRIMARY KEY,
            source_id   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            target_id   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            relation    TEXT NOT NULL,
            weight      DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            created_at  TEXT NOT NULL DEFAULT TO_CHAR(timezone('utc', now()), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
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
            created_at          TEXT NOT NULL DEFAULT TO_CHAR(timezone('utc', now()), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
        );

        -- Optional vector embeddings (f32 bytea)
        CREATE TABLE IF NOT EXISTS embeddings (
            memory_id   TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
            vector      BYTEA NOT NULL,
            model       TEXT NOT NULL DEFAULT 'bge-small-en-v1.5',
            dimensions  INTEGER NOT NULL DEFAULT 384,
            created_at  TEXT NOT NULL DEFAULT TO_CHAR(timezone('utc', now()), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
        );

        -- Indexes for common queries
        CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
        CREATE INDEX IF NOT EXISTS idx_memories_heat ON memories(current_heat DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories(is_pinned) WHERE is_pinned = 1;
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
        "
    )
    .execute(pool)
    .await?;

    tracing::info!("Initialized Sulcus local database (schema v{SCHEMA_VERSION})");
    Ok(())
}
