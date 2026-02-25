use std::path::PathBuf;
use std::time::Duration;

use tokio::task::JoinHandle;

use crate::{LocalStorage, McpHandler};
use pg_embed::pg_enums::PgAuthMethod;
use pg_embed::pg_fetch::{PgFetchSettings, PG_V15};
use pg_embed::postgres::{PgEmbed, PgSettings};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

use axum::{
    extract::Query,
    extract::State as AxState,
    response::sse::{Event, Sse},
    routing::{get, post},
    Router,
};
use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

const DEFAULT_PGLITE_PORT: u16 = 4201;
const DEFAULT_MCP_PORT: u16 = 4203;

static EMBEDDED_POSTGRES: Lazy<Mutex<Option<PgEmbed>>> = Lazy::new(|| Mutex::new(None));

async fn wait_for_shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let mut terminate_signal = signal(SignalKind::terminate()).ok();

        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = async {
                if let Some(sig) = terminate_signal.as_mut() {
                    sig.recv().await;
                } else {
                    std::future::pending::<()>().await;
                }
            } => {},
        }
    }

    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await.ok();
    }

    tracing::info!("shutdown signal received");
}

fn default_local_data_dir() -> anyhow::Result<PathBuf> {
    if let Ok(dir) = std::env::var("SULCUS_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let mut home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("home directory not found"))?;
    home.push(".sulcus");
    home.push("local");
    Ok(home)
}

fn ensure_local_dirs(base: &PathBuf) -> anyhow::Result<PathBuf> {
    let postgres_dir = base.join("postgres");
    std::fs::create_dir_all(base)?;
    std::fs::create_dir_all(&postgres_dir)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(base, std::fs::Permissions::from_mode(0o700))?;
        std::fs::set_permissions(&postgres_dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(postgres_dir)
}

async fn probe_connect(db_url: &str) -> anyhow::Result<()> {
    let connect_options: PgConnectOptions = db_url.parse()?;
    let connect_options = connect_options.statement_cache_capacity(0);

    let fut = async {
        let pool = PgPoolOptions::new()
            .test_before_acquire(false)
            .max_connections(1)
            .connect_with(connect_options)
            .await?;
        drop(pool);
        anyhow::Ok(())
    };
    match tokio::time::timeout(Duration::from_secs(5), fut).await {
        Ok(result) => result,
        Err(_) => Err(anyhow::anyhow!("connection probe timed out after 5s")),
    }
}

fn pick_local_port() -> anyhow::Result<u16> {
    if let Ok(raw) = std::env::var("SULCUS_DB_PORT") {
        if let Ok(port) = raw.parse::<u16>() {
            return Ok(port);
        }
    }
    if let Ok(raw) = std::env::var("SULCUS_PGLITE_PORT") {
        if let Ok(port) = raw.parse::<u16>() {
            return Ok(port);
        }
    }
    Ok(DEFAULT_PGLITE_PORT)
}

fn pick_mcp_addr() -> String {
    if let Ok(addr) = std::env::var("SULCUS_MCP_ADDR") {
        if !addr.trim().is_empty() {
            return addr;
        }
    }
    if let Ok(raw_port) = std::env::var("SULCUS_MCP_PORT") {
        if let Ok(port) = raw_port.parse::<u16>() {
            return format!("127.0.0.1:{}", port);
        }
    }
    format!("127.0.0.1:{}", DEFAULT_MCP_PORT)
}

fn local_postgres_dir() -> anyhow::Result<PathBuf> {
    let base = default_local_data_dir()?;
    ensure_local_dirs(&base)
}

async fn ensure_embedded_postgres_ready() -> anyhow::Result<String> {
    let base = default_local_data_dir()?;
    let postgres_dir = ensure_local_dirs(&base)?;

    let port = pick_local_port()?;
    let db_url = format!(
        "postgres://postgres:postgres@127.0.0.1:{}/postgres?sslmode=disable",
        port
    );

    if probe_connect(&db_url).await.is_ok() {
        return Ok(db_url);
    }

    {
        let mut guard = EMBEDDED_POSTGRES.lock().await;
        if guard.is_none() {
            let pg_settings = PgSettings {
                database_dir: postgres_dir,
                port,
                user: "postgres".to_string(),
                password: "postgres".to_string(),
                auth_method: PgAuthMethod::Plain,
                persistent: true,
                timeout: Some(Duration::from_secs(30)),
                migration_dir: None,
            };
            let fetch_settings = PgFetchSettings {
                version: PG_V15,
                ..Default::default()
            };

            let mut pg = PgEmbed::new(pg_settings, fetch_settings)
                .await
                .map_err(|e| anyhow::anyhow!("embedded postgres initialization failed: {e}"))?;
            pg.setup()
                .await
                .map_err(|e| anyhow::anyhow!("embedded postgres setup failed: {e}"))?;
            pg.start_db()
                .await
                .map_err(|e| anyhow::anyhow!("embedded postgres start failed: {e}"))?;
            *guard = Some(pg);
        }
    }

    let wait_ready = async {
        let mut last_error: Option<anyhow::Error> = None;
        for _ in 0..100 {
            match probe_connect(&db_url).await {
                Ok(()) => {
                    return anyhow::Ok(());
                }
                Err(err) => {
                    last_error = Some(err);
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        match last_error {
            Some(err) => Err(anyhow::anyhow!(
                "timed out waiting for embedded postgres to accept connections; last probe error: {err}"
            )),
            None => Err(anyhow::anyhow!(
                "timed out waiting for embedded postgres to accept connections"
            )),
        }
    };

    if let Err(wait_err) = wait_ready.await {
        return Err(anyhow::anyhow!(
            "timed out waiting for embedded postgres to start: {wait_err}"
        ));
    }

    Ok(db_url)
}

async fn stop_embedded_postgres_best_effort() {
    let port = match pick_local_port() {
        Ok(p) => p,
        Err(_) => return,
    };
    let postgres_dir = match local_postgres_dir() {
        Ok(p) => p,
        Err(_) => return,
    };

    let pg_settings = PgSettings {
        database_dir: postgres_dir,
        port,
        user: "postgres".to_string(),
        password: "postgres".to_string(),
        auth_method: PgAuthMethod::Plain,
        persistent: true,
        timeout: Some(Duration::from_secs(10)),
        migration_dir: None,
    };
    let fetch_settings = PgFetchSettings {
        version: PG_V15,
        ..Default::default()
    };

    if let Ok(mut pg) = PgEmbed::new(pg_settings, fetch_settings).await {
        let _ = pg.stop_db().await;
    }
}

pub async fn shutdown_embedded_postgres() {
    {
        let mut guard = EMBEDDED_POSTGRES.lock().await;
        if let Some(pg) = guard.as_mut() {
            let _ = pg.stop_db().await;
        }
        *guard = None;
    }

    stop_embedded_postgres_best_effort().await;
}

async fn resolve_database_url(db_url: Option<&str>) -> anyhow::Result<String> {
    if let Some(url) = db_url {
        if url.starts_with("sqlite:") {
            return Err(anyhow::anyhow!(
                "SQLite DSNs are not supported. Use a PostgreSQL-compatible URL (PGlite/Postgres)."
            ));
        }
        if let Err(err) = probe_connect(url).await {
            return Err(anyhow::anyhow!(
                "configured SULCUS_DATABASE_URL is unreachable: {err}"
            ));
        }
        return Ok(url.to_string());
    }

    if let Ok(url) = std::env::var("SULCUS_DATABASE_URL") {
        if url.starts_with("sqlite:") {
            return Err(anyhow::anyhow!(
                "SQLite DSNs are not supported. Use a PostgreSQL-compatible URL (PGlite/Postgres)."
            ));
        }
        if let Err(err) = probe_connect(&url).await {
            return Err(anyhow::anyhow!(
                "configured SULCUS_DATABASE_URL is unreachable: {err}"
            ));
        }
        return Ok(url);
    }

    ensure_embedded_postgres_ready().await
}

async fn run_migrations(db_url: &str) -> anyhow::Result<()> {
    let connect_options: PgConnectOptions = db_url.parse()?;
    let connect_options = connect_options.statement_cache_capacity(0);

    let migration_pool = PgPoolOptions::new()
        .test_before_acquire(false)
        .max_connections(1)
        .connect_with(connect_options)
        .await?;
    for migration_sql in [
        include_str!("../migrations/0001_create_tables.sql"),
        include_str!("../migrations/0002_typed_memories.sql"),
        include_str!("../migrations/0003_crdt_clocks.sql"),
    ] {
        sqlx::raw_sql(migration_sql)
            .execute(&migration_pool)
            .await?;
    }
    migration_pool.close().await;
    Ok(())
}

pub async fn initialize(db_url: Option<&str>) -> anyhow::Result<String> {
    let db_url = resolve_database_url(db_url).await?;
    run_migrations(&db_url).await?;
    Ok(db_url)
}

pub async fn reinitialize_local() -> anyhow::Result<String> {
    {
        let mut guard = EMBEDDED_POSTGRES.lock().await;
        if let Some(pg) = guard.as_mut() {
            let _ = pg.stop_db().await;
        }
        *guard = None;
    }

    stop_embedded_postgres_best_effort().await;
    tokio::time::sleep(Duration::from_millis(300)).await;

    let postgres_dir = local_postgres_dir()?;
    if postgres_dir.exists() {
        std::fs::remove_dir_all(&postgres_dir)?;
        std::fs::create_dir_all(&postgres_dir)?;
    }
    initialize(None).await
}

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
    db_url: Option<&str>,
    decay: f32,
    prune_threshold: f32,
    active_limit: usize,
    interval_ms: u64,
) -> anyhow::Result<(LocalStorage, JoinHandle<()>)> {
    // Resolve URL with encapsulated-local fallback and ensure schema is initialized.
    let db_url = initialize(db_url).await?;

    tracing::debug!(db_url = %db_url, "connecting to PostgreSQL-compatible backend");

    let storage = LocalStorage::new(&db_url).await?;

    // Pre-load all embeddings into the in-memory vector cache.
    // This makes every subsequent ignite() call O(RAM) instead of O(disk).
    if let Err(e) = storage.warm_up_vector_cache().await {
        eprintln!("WARN: vector cache warm-up failed (continuing without cache): {e:?}");
    }

    // initialize optional Prometheus metrics (spawn exporter if SULCUS_METRICS_ADDR is set)
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

/// Initialise an embedding provider in a separate thread so that a panic from
/// the ONNX/ORT dylib loader is caught by `thread::join` and we can fall back to
/// `MockEmbeddingProvider` without crashing the whole process.
fn create_embedder() -> std::sync::Arc<dyn crate::embeddings::EmbeddingProvider> {
    crate::embeddings::ensure_onnx_runtime_env();

    let (tx, rx) = std::sync::mpsc::channel();
    let _ = std::thread::Builder::new()
        .name("fastembed-init".to_string())
        .spawn(move || {
            let res = std::panic::catch_unwind(crate::embeddings::FastEmbedProvider::try_new);
            let _ = tx.send(res);
        });

    match rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(Ok(Ok(embedder))) => {
            tracing::info!("fastembed embedding provider ready");
            std::sync::Arc::new(embedder)
        }
        Ok(Ok(Err(err))) => {
            tracing::warn!(error = %err, "fastembed init failed – using MockEmbeddingProvider");
            std::sync::Arc::new(crate::embeddings::MockEmbeddingProvider::new())
        }
        Ok(Err(_panic)) => {
            tracing::warn!(
                "fastembed init panicked (missing dylib?) – using MockEmbeddingProvider"
            );
            std::sync::Arc::new(crate::embeddings::MockEmbeddingProvider::new())
        }
        Err(_timeout) => {
            tracing::warn!("fastembed init timed out – using MockEmbeddingProvider");
            std::sync::Arc::new(crate::embeddings::MockEmbeddingProvider::new())
        }
    }
}

/// Start the long-lived CLI service: spawns background worker and runs MCP stdio loop.
/// Blocks until Ctrl-C.
pub async fn serve(db_url: Option<&str>, interval_ms: u64) -> anyhow::Result<()> {
    let (storage, handle) = start_background(db_url, 0.85, 1.0, 20, interval_ms).await?;

    // instantiate an embedding provider; prefer `fastembed` but gracefully fall back to the mock provider
    let embedder = create_embedder();

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

    let addr = pick_mcp_addr();
    tracing::info!(
        addr = %addr,
        "starting sulcus-local MCP SSE server"
    );

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let server = axum::serve(listener, app);

    // wait for ctrl-c and shutdown gracefully
    server
        .with_graceful_shutdown(wait_for_shutdown_signal())
        .await?;
    handle.abort();

    if db_url.is_none() {
        shutdown_embedded_postgres().await;
    }

    Ok(())
}

/// Run MCP over stdin/stdout (newline-delimited JSON-RPC). Used by the `stdio` subcommand.
/// This is multi-client-safe: each invocation gets its own process, so no port conflicts.
/// stdout carries only JSON-RPC messages; all tracing output goes to stderr (configured in main).
pub async fn serve_stdio(db_url: Option<&str>, interval_ms: u64) -> anyhow::Result<()> {
    let (storage, handle) = start_background(db_url, 0.85, 1.0, 20, interval_ms).await?;

    let embedder = create_embedder();

    let handler = McpHandler::new(storage, embedder);
    let res = handler.run_stdio_loop().await;

    handle.abort();
    if db_url.is_none() {
        shutdown_embedded_postgres().await;
    }

    res
}
