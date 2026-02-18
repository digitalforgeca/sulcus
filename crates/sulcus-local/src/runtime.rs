use std::path::PathBuf;
use std::time::Duration;

use anyhow::Context;
use tokio::task::JoinHandle;

use crate::{McpHandler, SqliteStorage};

use axum::{
    extract::Query,
    extract::State as AxState,
    response::sse::{Event, Sse},
    routing::{get, post},
    Router,
};
use dashmap::DashMap;
use futures::Stream;
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

/// Shared HTTP/SSE state for MCP sessions.
#[derive(Clone)]
pub struct AppState {
    pub sessions: DashMap<String, mpsc::Sender<Result<Event, Infallible>>>,
    pub handler: Arc<crate::McpHandler>,
}

/// GET /sse - MCP SSE handshake. Emits an `endpoint` event immediately with the POST URL.
pub async fn sse_endpoint(
    AxState(state): AxState<Arc<AppState>>,
) -> Sse<ReceiverStream<Result<Event, Infallible>>> {
    let session_id = Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(32);
    state.sessions.insert(session_id.clone(), tx.clone());

    // Immediately notify client where to POST JSON-RPC messages for this session.
    let endpoint_event = Event::default()
        .event("endpoint")
        .data(format!("/message?sessionId={}", session_id));
    let _ = tx.send(Ok(endpoint_event)).await;

    Sse::new(ReceiverStream::new(rx))
}

/// POST /message - receive a JSON-RPC 2.0 envelope and route to existing McpHandler.
pub async fn post_message(
    AxState(state): AxState<Arc<AppState>>,
    Query(params): Query<std::collections::HashMap<String, String>>,
    body: String,
) -> (axum::http::StatusCode, &'static str) {
    let session_id = match params.get("sessionId") {
        Some(s) => s.clone(),
        None => return (axum::http::StatusCode::BAD_REQUEST, "missing sessionId"),
    };

    match state.handler.handle_request(&body).await {
        Ok(resp_str) => {
            if let Some(sender) = state.sessions.get(&session_id) {
                let ev = Event::default().event("message").data(resp_str.clone());
                let send_res = sender.send(Ok(ev)).await;
                if send_res.is_err() {
                    // client disconnected — remove stale session
                    state.sessions.remove(&session_id);
                }
            }
            (axum::http::StatusCode::ACCEPTED, "accepted")
        }
        Err(_) => (axum::http::StatusCode::BAD_REQUEST, "invalid jsonrpc"),
    }
}

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

    // initialize optional Prometheus metrics (spawn exporter if SULCUS_PROMETHEUS_PORT is set)
    let _metrics = crate::metrics::init_from_env().ok();

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

    // instantiate an embedding provider; prefer `fastembed` but gracefully fall back to the mock provider
    let embedder: std::sync::Arc<dyn crate::embeddings::EmbeddingProvider> =
        match crate::embeddings::FastEmbedProvider::try_new() {
            Ok(e) => std::sync::Arc::new(e),
            Err(err) => {
                tracing::warn!(error = %err, "fastembed init failed - using MockEmbeddingProvider");
                std::sync::Arc::new(crate::embeddings::MockEmbeddingProvider::new())
            }
        };

    let handler = McpHandler::new(storage.clone(), embedder);

    // Start HTTP/SSE MCP server (SSE handshake + POST /message) and block until Ctrl-C.
    let app_state = Arc::new(AppState {
        sessions: DashMap::new(),
        handler: Arc::new(handler),
    });

    let app = Router::new()
        .route("/sse", get(sse_endpoint))
        .route("/message", post(post_message))
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    let addr = "127.0.0.1:8173".parse().expect("invalid bind address");
    tracing::info!(%addr, "starting sulcus-local MCP SSE server on http://127.0.0.1:8173");

    let server = axum::Server::bind(&addr).serve(app.into_make_service());

    // wait for ctrl-c and shutdown gracefully
    let shutdown_signal = async {
        tokio::signal::ctrl_c().await.ok();
        tracing::info!("shutdown signal received");
    };

    server.with_graceful_shutdown(shutdown_signal).await?;
    Ok(())
}
