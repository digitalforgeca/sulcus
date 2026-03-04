use std::path::PathBuf;
use std::time::Duration;
use std::process::Stdio;

use tokio::task::JoinHandle;
use tokio::process::Command;

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
static PGLITE_PROCESS: Lazy<Mutex<Option<tokio::process::Child>>> = Lazy::new(|| Mutex::new(None));

async fn wait_for_shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate_signal = signal(SignalKind::terminate()).ok();
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = async {
                if let Some(sig) = terminate_signal.as_mut() { sig.recv().await; }
                else { std::future::pending::<()>().await; }
            } => {},
        }
    }
    #[cfg(not(unix))] { tokio::signal::ctrl_c().await.ok(); }
    tracing::info!("shutdown signal received");
}

fn default_local_data_dir() -> anyhow::Result<PathBuf> {
    if let Ok(dir) = std::env::var("SULCUS_DATA_DIR") { return Ok(PathBuf::from(dir)); }
    let mut home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("home directory not found"))?;
    home.push(".sulcus"); home.push("local");
    Ok(home)
}

fn ensure_local_dirs(base: &PathBuf) -> anyhow::Result<PathBuf> {
    let postgres_dir = base.join("postgres");
    std::fs::create_dir_all(base)?;
    std::fs::create_dir_all(&postgres_dir)?;
    #[cfg(unix)] {
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
        let pool = PgPoolOptions::new().test_before_acquire(false).max_connections(1).connect_with(connect_options).await?;
        drop(pool);
        anyhow::Ok(())
    };
    match tokio::time::timeout(Duration::from_secs(5), fut).await {
        Ok(result) => result,
        Err(_) => Err(anyhow::anyhow!("connection probe timed out after 5s")),
    }
}

fn pick_local_port() -> anyhow::Result<u16> {
    if let Ok(raw) = std::env::var("SULCUS_DB_PORT") { if let Ok(port) = raw.parse::<u16>() { return Ok(port); } }
    if let Ok(raw) = std::env::var("SULCUS_PGLITE_PORT") { if let Ok(port) = raw.parse::<u16>() { return Ok(port); } }
    Ok(DEFAULT_PGLITE_PORT)
}

fn pick_mcp_addr() -> String {
    if let Ok(addr) = std::env::var("SULCUS_MCP_ADDR") { if !addr.trim().is_empty() { return addr; } }
    if let Ok(raw_port) = std::env::var("SULCUS_MCP_PORT") { if let Ok(port) = raw_port.parse::<u16>() { return format!("127.0.0.1:{}", port); } }
    format!("127.0.0.1:{}", DEFAULT_MCP_PORT)
}

async fn start_inbuilt_pglite() -> anyhow::Result<String> {
    let base = default_local_data_dir()?;
    let postgres_dir = ensure_local_dirs(&base)?;
    let port = pick_local_port()?;
    let db_url = format!("postgres://postgres:postgres@127.0.0.1:{}/postgres?sslmode=disable", port);

    if probe_connect(&db_url).await.is_ok() { return Ok(db_url); }

    // Try to find the JS PGlite server
    let mut js_server_path = std::env::current_dir()?;
    js_server_path.push("packages/sulcus-pglite/dist/bin/pglite-server.js");

    if js_server_path.exists() {
        tracing::info!("starting inbuilt pglite service (with pgvector support)...");
        let child = Command::new("node")
            .arg(js_server_path)
            .arg(format!("--port={}", port))
            .arg(format!("--storage=fs:{}", postgres_dir.display()))
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()?;
        
        let mut guard = PGLITE_PROCESS.lock().await;
        *guard = Some(child);

        // wait for ready
        for _ in 0..50 {
            if probe_connect(&db_url).await.is_ok() { return Ok(db_url); }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    tracing::warn!("inbuilt pglite JS service not found or failed to start; falling back to vanilla pg-embed (no pgvector support)");
    
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
        let fetch_settings = PgFetchSettings { version: PG_V15, ..Default::default() };
        let mut pg = PgEmbed::new(pg_settings, fetch_settings).await.map_err(|e| anyhow::anyhow!("{e}"))?;
        pg.setup().await.map_err(|e| anyhow::anyhow!("{e}"))?;
        pg.start_db().await.map_err(|e| anyhow::anyhow!("{e}"))?;
        *guard = Some(pg);
    }
    
    Ok(db_url)
}

pub async fn shutdown_embedded_postgres() {
    {
        let mut guard = PGLITE_PROCESS.lock().await;
        if let Some(mut child) = guard.take() {
            let _ = child.kill().await;
        }
    }
    {
        let mut guard = EMBEDDED_POSTGRES.lock().await;
        if let Some(pg) = guard.as_mut() { let _ = pg.stop_db().await; }
        *guard = None;
    }
}

pub async fn initialize(db_url: Option<&str>) -> anyhow::Result<String> {
    let db_url = if let Some(url) = db_url { url.to_string() } 
                 else if let Ok(url) = std::env::var("SULCUS_DATABASE_URL") { url }
                 else { start_inbuilt_pglite().await? };
    
    run_migrations(&db_url).await?;
    Ok(db_url)
}

async fn run_migrations(db_url: &str) -> anyhow::Result<()> {
    use sqlx::Executor;
    let connect_options: PgConnectOptions = db_url.parse()?;
    let connect_options = connect_options.statement_cache_capacity(0);
    let migration_pool = PgPoolOptions::new().max_connections(1).connect_with(connect_options).await?;
    for migration_sql in [
        include_str!("../migrations/0001_create_tables.sql"),
        include_str!("../migrations/0002_typed_memories.sql"),
        include_str!("../migrations/0003_crdt_clocks.sql"),
    ] {
        // Simple statement splitter: split by semicolon but ignore inside BEGIN/COMMIT or blocks if needed.
        // For our migrations, simple split is enough if we remove BEGIN/COMMIT.
        let sql = migration_sql.replace("BEGIN;", "").replace("COMMIT;", "");
        for stmt in sql.split(';') {
            let s = stmt.trim();
            if s.is_empty() { continue; }
            if let Err(e) = migration_pool.execute(s).await {
                let msg = e.to_string();
                if !msg.contains("extension \"vector\" is not available") && !msg.contains("already exists") {
                    return Err(anyhow::anyhow!("Migration statement failed: {}\nSQL: {}", e, s));
                }
            }
        }
    }
    migration_pool.close().await;
    Ok(())
}

pub async fn reinitialize_local() -> anyhow::Result<String> {
    shutdown_embedded_postgres().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let base = default_local_data_dir()?;
    let postgres_dir = ensure_local_dirs(&base)?;
    if postgres_dir.exists() { std::fs::remove_dir_all(&postgres_dir)?; }
    initialize(None).await
}

#[derive(Clone)]
pub struct AppState {
    pub sessions: DashMap<String, mpsc::Sender<Result<Event, Infallible>>>,
    pub handler: Arc<crate::McpHandler>,
}

pub async fn sse_endpoint(AxState(state): AxState<Arc<AppState>>) -> Sse<ReceiverStream<Result<Event, Infallible>>> {
    let session_id = Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(32);
    state.sessions.insert(session_id.clone(), tx.clone());
    let _ = tx.send(Ok(Event::default().event("endpoint").data(format!("/message?sessionId={}", session_id)))).await;
    Sse::new(ReceiverStream::new(rx))
}

pub async fn post_message(AxState(state): AxState<Arc<AppState>>, Query(params): Query<std::collections::HashMap<String, String>>, body: String) -> (axum::http::StatusCode, &'static str) {
    let session_id = match params.get("sessionId") { Some(s) => s.clone(), None => return (axum::http::StatusCode::BAD_REQUEST, "missing sessionId"), };
    match state.handler.handle_request(&body).await {
        Ok(resp_str) => {
            if let Some(sender) = state.sessions.get(&session_id) {
                if sender.send(Ok(Event::default().event("message").data(resp_str.clone()))).await.is_err() { state.sessions.remove(&session_id); }
            }
            (axum::http::StatusCode::ACCEPTED, "accepted")
        }
        Err(_) => (axum::http::StatusCode::BAD_REQUEST, "invalid jsonrpc"),
    }
}

pub async fn start_background(db_url: Option<&str>, decay: f32, prune_threshold: f32, active_limit: usize, interval_ms: u64) -> anyhow::Result<(LocalStorage, JoinHandle<()>)> {
    let db_url = initialize(db_url).await?;
    let storage = LocalStorage::new(&db_url).await?;
    let _metrics = crate::metrics::init_from_env().ok();
    let handle = crate::spawn_worker(storage.clone(), decay, prune_threshold, active_limit, Duration::from_millis(interval_ms));
    
    if let Ok(server_url) = std::env::var("SULCUS_SERVER_URL") {
        let api_key = std::env::var("SULCUS_API_KEY").ok();
        let sync_interval = std::env::var("SULCUS_SYNC_INTERVAL_MS").ok().and_then(|s| s.parse().ok()).unwrap_or(30_000u64);
        let _sync_handle = crate::spawn_sync_worker(std::sync::Arc::new(crate::sync_http::HttpSyncEngine::new(server_url, api_key)), storage.clone(), Duration::from_millis(sync_interval));
    }
    Ok((storage, handle))
}

fn create_embedder() -> std::sync::Arc<dyn crate::embeddings::EmbeddingProvider> {
    crate::embeddings::ensure_onnx_runtime_env();
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = std::thread::Builder::new().name("fastembed-init".to_string()).spawn(move || { let _ = tx.send(std::panic::catch_unwind(crate::embeddings::FastEmbedProvider::try_new)); });
    match rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(Ok(Ok(embedder))) => { tracing::info!("fastembed embedding provider ready"); std::sync::Arc::new(embedder) }
        _ => { tracing::warn!("fastembed init failed – using MockEmbeddingProvider"); std::sync::Arc::new(crate::embeddings::MockEmbeddingProvider::new()) }
    }
}

pub async fn serve(db_url: Option<&str>, interval_ms: u64) -> anyhow::Result<()> {
    let (storage, handle) = start_background(db_url, 0.85, 0.05, 20, interval_ms).await?;
    let handler = McpHandler::new(storage.clone(), create_embedder());
    let app = Router::new().route("/sse", get(sse_endpoint)).route("/message", post(post_message)).layer(CorsLayer::permissive()).with_state(Arc::new(AppState { sessions: DashMap::new(), handler: Arc::new(handler) }));
    let listener = tokio::net::TcpListener::bind(&pick_mcp_addr()).await?;
    axum::serve(listener, app).with_graceful_shutdown(wait_for_shutdown_signal()).await?;
    handle.abort();
    if db_url.is_none() { shutdown_embedded_postgres().await; }
    Ok(())
}

pub async fn serve_stdio(db_url: Option<&str>, interval_ms: u64) -> anyhow::Result<()> {
    let (storage, handle) = start_background(db_url, 0.85, 0.05, 20, interval_ms).await?;
    let res = McpHandler::new(storage, create_embedder()).run_stdio_loop().await;
    handle.abort();
    if db_url.is_none() { shutdown_embedded_postgres().await; }
    res
}
