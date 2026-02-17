use std::path::PathBuf;
use std::time::Duration;

use anyhow::Context;
use tokio::task::JoinHandle;

use crate::{McpHandler, SqliteStorage};

/// Start the local runtime in background mode: runs migrations, creates storage,
/// spawns the thermodynamics worker and returns the storage + worker handle.
pub async fn start_background(
    db_path: Option<&str>,
    decay: f32,
    prune_threshold: f32,
    active_limit: usize,
    interval_ms: u64,
) -> anyhow::Result<(SqliteStorage, JoinHandle<()>)> {
    // determine DB path
    let db_path = match db_path {
        Some(p) => PathBuf::from(p),
        None => {
            let mut dir = dirs::home_dir().context("home dir not found")?;
            dir.push(".sulcus");
            std::fs::create_dir_all(&dir)?;
            dir.push("memory.db");
            dir
        }
    };

    // Ensure parent directory exists when `db_path` was provided by the caller (SULCUS_DB_PATH).
    // This prevents SQLITE_CANTOPEN errors on platforms where parent dirs are missing or permissions differ.
    if let Some(parent) = db_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    // Ensure the DB file is createable (some SQLite backends/hosts require the file existable by the process).
    if !db_path.exists() {
        use std::fs::OpenOptions;
        let _ = OpenOptions::new().create(true).write(true).open(&db_path)?;
    }

    let db_url = format!("sqlite://{}", db_path.display());
    tracing::debug!(db_path = %db_path.display(), db_url = %db_url, exists = %db_path.exists(), "connecting to sqlite");
    let pool = sqlx::SqlitePool::connect(&db_url).await?;

    // run simple migrations (single SQL file)
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() {
            continue;
        }
        sqlx::query(s).execute(&pool).await?;
    }

    let storage = SqliteStorage::new(&db_url).await?;

    let handle = crate::spawn_worker(
        storage.clone(),
        decay,
        prune_threshold,
        active_limit,
        Duration::from_millis(interval_ms),
    );

    // Optional: wire sync worker if SULCUS_SERVER_URL is configured
    if let Ok(server_url) = std::env::var("SULCUS_SERVER_URL") {
        let api_key = std::env::var("SULCUS_API_KEY").ok();
        let sync_interval = std::env::var("SULCUS_SYNC_INTERVAL_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30_000u64);
        let http_engine = crate::sync_http::HttpSyncEngine::new(server_url, api_key);
        let engine_arc: std::sync::Arc<dyn sulcus_core::sync::SyncEngine + Send + Sync> =
            std::sync::Arc::new(http_engine);
        let _sync_handle = crate::spawn_sync_worker(
            engine_arc,
            storage.clone(),
            Duration::from_millis(sync_interval),
        );
    }

    Ok((storage, handle))
}

/// Start the long-running CLI service: spawns background worker and runs MCP stdio loop.
/// Blocks until Ctrl-C.
pub async fn serve(db_path: Option<&str>, interval_ms: u64) -> anyhow::Result<()> {
    let (storage, _handle) = start_background(db_path, 0.85, 1.0, 20, interval_ms).await?;

    let handler = McpHandler::new(storage.clone());

    // run stdio loop and shutdown on ctrl-c
    let loop_handle = tokio::spawn(async move {
        if let Err(e) = handler.run_stdio_loop().await {
            tracing::error!(error = %e, "mcp stdio loop failed");
        }
    });

    tokio::signal::ctrl_c().await?;
    tracing::info!("shutdown signal received");

    // abort the stdio loop and return
    loop_handle.abort();
    Ok(())
}
