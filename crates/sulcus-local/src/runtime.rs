use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::task::JoinHandle;

use crate::{LocalStorage, McpHandler};
use pg_embed::pg_enums::PgAuthMethod;
use pg_embed::pg_fetch::{PgFetchSettings, PG_V17};
use pg_embed::postgres::{PgEmbed, PgSettings};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

use axum::{
    extract::Query,
    extract::State as AxState,
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
    routing::{delete, get, patch, post},
    Router,
};
use chrono::Utc;
use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
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

async fn start_inbuilt_pglite() -> anyhow::Result<String> {
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
            if probe_connect(&db_url).await.is_ok() {
                return Ok(db_url);
            }
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
        let fetch_settings = PgFetchSettings {
            version: PG_V17,
            ..Default::default()
        };
        let mut pg = PgEmbed::new(pg_settings, fetch_settings)
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
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
        if let Some(pg) = guard.as_mut() {
            let _ = pg.stop_db().await;
        }
        *guard = None;
    }
}

pub async fn initialize(db_url: Option<&str>) -> anyhow::Result<String> {
    let db_url = if let Some(url) = db_url {
        url.to_string()
    } else if let Ok(url) = std::env::var("SULCUS_DATABASE_URL") {
        url
    } else {
        start_inbuilt_pglite().await?
    };

    run_migrations(&db_url).await?;
    Ok(db_url)
}

/// Split a SQL script into individual statements, correctly handling:
/// - Dollar-quoted strings (`$$…$$`, `$tag$…$tag$`) — semicolons inside are NOT separators
/// - Single-quoted strings — semicolons inside are NOT separators
/// - `--` line comments and `/* */` block comments
/// - `BEGIN;` / `COMMIT;` transaction wrappers (stripped before calling)
fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut statements: Vec<String> = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = sql.chars().collect();
    let n = chars.len();
    let mut i = 0;
    let mut in_single_quote = false;
    let mut in_dollar_quote = false;
    let mut dollar_tag = String::new();
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while i < n {
        let ch = chars[i];

        // ── line comment ──────────────────────────────────────────────────────
        if !in_dollar_quote
            && !in_single_quote
            && !in_block_comment
            && !in_line_comment
            && ch == '-'
            && i + 1 < n
            && chars[i + 1] == '-'
        {
            in_line_comment = true;
            current.push(ch);
            i += 1;
            continue;
        }
        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
            }
            current.push(ch);
            i += 1;
            continue;
        }

        // ── block comment ─────────────────────────────────────────────────────
        if !in_dollar_quote
            && !in_single_quote
            && !in_line_comment
            && ch == '/'
            && i + 1 < n
            && chars[i + 1] == '*'
        {
            in_block_comment = true;
            current.push(ch);
            i += 1;
            continue;
        }
        if in_block_comment {
            current.push(ch);
            if ch == '*' && i + 1 < n && chars[i + 1] == '/' {
                in_block_comment = false;
                current.push(chars[i + 1]);
                i += 2;
            } else {
                i += 1;
            }
            continue;
        }

        // ── single-quoted string ──────────────────────────────────────────────
        if !in_dollar_quote && ch == '\'' {
            in_single_quote = !in_single_quote;
            current.push(ch);
            i += 1;
            continue;
        }
        if in_single_quote {
            current.push(ch);
            i += 1;
            continue;
        }

        // ── dollar-quoted string ──────────────────────────────────────────────
        if ch == '$' {
            // Collect potential tag: $[ident]$
            let start = i;
            let mut j = i + 1;
            while j < n && chars[j] != '$' && (chars[j].is_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            if j < n && chars[j] == '$' {
                let tag: String = chars[start..=j].iter().collect();
                if in_dollar_quote && tag == dollar_tag {
                    // close
                    in_dollar_quote = false;
                    current.push_str(&tag);
                    i = j + 1;
                } else if !in_dollar_quote {
                    // open
                    in_dollar_quote = true;
                    dollar_tag = tag.clone();
                    current.push_str(&tag);
                    i = j + 1;
                } else {
                    // nested / different tag — treat as plain text
                    current.push(ch);
                    i += 1;
                }
                continue;
            }
        }
        if in_dollar_quote {
            current.push(ch);
            i += 1;
            continue;
        }

        // ── statement separator ───────────────────────────────────────────────
        if ch == ';' {
            let stmt = current.trim().to_string();
            if !stmt.is_empty() {
                statements.push(stmt);
            }
            current = String::new();
        } else {
            current.push(ch);
        }
        i += 1;
    }
    let stmt = current.trim().to_string();
    if !stmt.is_empty() {
        statements.push(stmt);
    }
    statements
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
        include_str!("../migrations/0004_cognitive_thermodynamics.sql"),
        include_str!("../migrations/0005_hnsw_cross_modal_namespace.sql"),
        include_str!("../migrations/0006_p2p_peers.sql"),
        include_str!("../migrations/0007_edges_target_idx.sql"),
        include_str!("../migrations/0007_localized_diff_sync.sql"),
        include_str!("../migrations/0008_fix_decay_math.sql"),
        include_str!("../migrations/0009_thermo_node_fields.sql"),
        include_str!("../migrations/0010_thermo_config.sql"),
        include_str!("../migrations/0011_triggers.sql"),
    ] {
        // Strip bare transaction wrappers; split with a dollar-quote-aware parser.
        let sql: String = migration_sql.replace("BEGIN;", "").replace("COMMIT;", "");
        for stmt in split_sql_statements(&sql) {
            let s: &str = stmt.as_str();
            if let Err(e) = sqlx::raw_sql(s).execute(&migration_pool).await {
                let msg = e.to_string();
                if !msg.contains("extension \"vector\" is not available")
                    && !msg.contains("already exists")
                    // pg_class duplicate: concurrent migration creating the same index
                    && !msg.contains("pg_class_relname_nsp_index")
                {
                    return Err(anyhow::anyhow!(
                        "Migration statement failed: {}\nSQL: {}",
                        e,
                        s
                    ));
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
    if postgres_dir.exists() {
        std::fs::remove_dir_all(&postgres_dir)?;
    }
    initialize(None).await
}

#[derive(Clone)]
pub struct AppState {
    pub sessions: DashMap<String, mpsc::Sender<Result<Event, Infallible>>>,
    pub handler: Arc<crate::McpHandler>,
}

pub async fn sse_endpoint(
    AxState(state): AxState<Arc<AppState>>,
) -> Sse<ReceiverStream<Result<Event, Infallible>>> {
    let session_id = Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(32);
    state.sessions.insert(session_id.clone(), tx.clone());
    let _ = tx
        .send(Ok(Event::default()
            .event("endpoint")
            .data(format!("/message?sessionId={}", session_id))))
        .await;
    Sse::new(ReceiverStream::new(rx))
}

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
                if sender
                    .send(Ok(Event::default().event("message").data(resp_str.clone())))
                    .await
                    .is_err()
                {
                    state.sessions.remove(&session_id);
                }
            }
            (axum::http::StatusCode::ACCEPTED, "accepted")
        }
        Err(_) => (axum::http::StatusCode::BAD_REQUEST, "invalid jsonrpc"),
    }
}

pub async fn p2p_sync(
    AxState(state): AxState<Arc<AppState>>,
    axum::extract::Json(payload): axum::extract::Json<Value>,
) -> axum::response::Response {
    let ops_val = payload.get("ops").cloned().unwrap_or(json!([]));

    struct PayloadEngine(Vec<sulcus_core::sync::MemoryOp>);
    #[async_trait::async_trait]
    impl sulcus_core::sync::SyncEngine for PayloadEngine {
        async fn push(
            &self,
            _ops: Vec<sulcus_core::sync::MemoryOp>,
        ) -> anyhow::Result<sulcus_core::sync::SyncPushResult> {
            Ok(sulcus_core::sync::SyncPushResult {
                new_cursor: None,
                new_cursor_seq: None,
            })
        }
        async fn pull(
            &self,
            _since: Option<chrono::DateTime<Utc>>,
        ) -> anyhow::Result<sulcus_core::sync::SyncPullResult> {
            Ok(sulcus_core::sync::SyncPullResult {
                ops: self.0.clone(),
                new_cursor: None,
                new_cursor_seq: None,
            })
        }
    }

    if let Ok(ops) = serde_json::from_value::<Vec<sulcus_core::sync::MemoryOp>>(ops_val) {
        // Filter out raw conversation turn junk: episodic nodes with placeholder vectors
        // (all values ≈ 0.1, no real embeddings) or labels starting with "user:" / "assistant:"
        // that contain raw JSON conversation payloads.
        let filtered: Vec<_> = ops
            .into_iter()
            .filter(|op| {
                if let Some(ref node) = op.payload {
                    // Skip episodic nodes whose label starts with "user:" or "assistant:"
                    // and whose pointer_summary contains raw JSON (conversation metadata)
                    let label = &node.label;
                    if node.memory_type == "episodic"
                        && (label.starts_with("user:") || label.starts_with("assistant:"))
                    {
                        tracing::debug!(
                            "p2p_sync: filtering out raw conversation turn: {}",
                            label.chars().take(60).collect::<String>()
                        );
                        return false;
                    }
                    // Skip any node with a placeholder vector (all values identical near 0.1)
                    if let Some(ref vec) = op.vector {
                        if vec.len() > 10 {
                            let first = vec[0];
                            let all_same = vec.iter().all(|v| (v - first).abs() < 0.001);
                            if all_same && (first - 0.1).abs() < 0.05 {
                                tracing::debug!(
                                    "p2p_sync: filtering out placeholder-vector node: {}",
                                    label.chars().take(60).collect::<String>()
                                );
                                return false;
                            }
                        }
                    }
                }
                true
            })
            .collect();
        if !filtered.is_empty() {
            let engine = PayloadEngine(filtered);
            let mut client = crate::LocalSyncClient::new(state.handler.storage().clone());
            let _ = client.pull_from_engine_and_apply(&engine, None).await;
        }
    }

    // Return pending local ops for the 'pull' part of the exchange
    let pending = state
        .handler
        .storage()
        .list_memory_ops_internal()
        .await
        .unwrap_or_default();
    let mut out_ops = Vec::new();
    for (_seq, _op_type_str, p_val) in pending {
        if let Ok(op) = serde_json::from_value::<sulcus_core::sync::MemoryOp>(p_val) {
            out_ops.push(op);
        }
    }

    axum::response::Json(json!({
        "new_ops": out_ops,
        "new_cursor": Utc::now().to_rfc3339(),
        "new_cursor_seq": 1
    }))
    .into_response()
}

pub async fn start_background(
    db_url: Option<&str>,
    decay: f32,
    prune_threshold: f32,
    active_limit: usize,
    interval_ms: u64,
) -> anyhow::Result<(LocalStorage, JoinHandle<()>)> {
    let db_url = initialize(db_url).await?;
    let storage = LocalStorage::new(&db_url).await?;
    let _metrics = crate::metrics::init_from_env().ok();
    let handle = crate::spawn_worker(
        storage.clone(),
        decay,
        prune_threshold,
        active_limit,
        Duration::from_millis(interval_ms),
    );

    let _sync_handle = crate::sync::spawn_auto_sync_worker(storage.clone());

    // Localized Differential Sync: Start discovery worker
    let mcp_port = std::env::var("SULCUS_MCP_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_MCP_PORT);
    crate::discovery::start_discovery_worker(storage.clone(), mcp_port).await;
    crate::discovery::start_p2p_sync_worker(storage.clone()).await;

    Ok((storage, handle))
}

fn create_embedder() -> std::sync::Arc<dyn crate::embeddings::EmbeddingProvider> {
    crate::embeddings::ensure_onnx_runtime_env();
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = std::thread::Builder::new()
        .name("fastembed-init".to_string())
        .spawn(move || {
            let _ = tx.send(std::panic::catch_unwind(
                crate::embeddings::FastEmbedProvider::try_new,
            ));
        });
    match rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(Ok(Ok(embedder))) => {
            tracing::info!("fastembed embedding provider ready");
            std::sync::Arc::new(embedder)
        }
        _ => {
            tracing::warn!("fastembed init failed – using MockEmbeddingProvider");
            std::sync::Arc::new(crate::embeddings::MockEmbeddingProvider::new())
        }
    }
}

pub async fn serve(
    db_url: Option<&str>,
    interval_ms: u64,
    active_limit: usize,
) -> anyhow::Result<()> {
    // Initialize telemetry
    crate::telemetry::init_from_env();

    let (storage, handle) = start_background(db_url, 0.85, 0.05, active_limit, interval_ms).await?;
    // McpHandler loads config (including storage limits) automatically
    let handler = McpHandler::new(storage.clone(), create_embedder(), active_limit);

    let state = Arc::new(AppState {
        sessions: DashMap::new(),
        handler: Arc::new(handler),
    });

    // Spawn telemetry heartbeat
    let telemetry_url = std::env::var("SULCUS_TELEMETRY_URL").unwrap_or_else(|_| {
        "https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io".into()
    });
    let telem_state = crate::telemetry::TelemetryState::new(storage.clone(), telemetry_url).await;
    telem_state.set_panel_active(true);
    crate::telemetry::spawn_heartbeat(telem_state);

    // MCP transport routes
    let mcp_routes = Router::new()
        .route("/sse", get(sse_endpoint))
        .route("/message", post(post_message))
        .route("/api/v1/agent/sync", post(p2p_sync));

    // Local control panel API routes (same contract as sulcus-server)
    let panel_routes = Router::new()
        .route(
            "/api/v1/admin/dashboard",
            get(crate::local_api::dashboard_stats),
        )
        .route("/api/v1/admin/usage", get(crate::local_api::usage_stats))
        .route("/api/v1/agent/nodes", get(crate::local_api::list_memories))
        .route(
            "/api/v1/agent/nodes/:id",
            get(crate::local_api::get_node)
                .patch(crate::local_api::patch_node)
                .delete(crate::local_api::delete_node),
        )
        .route("/api/v1/agent/hot_nodes", get(crate::local_api::hot_nodes))
        .route("/api/v1/agent/search", post(crate::local_api::text_search))
        .route("/api/v1/metrics", get(crate::local_api::metrics))
        .route(
            "/api/v1/admin/visualize/graph",
            get(crate::local_api::visualize_graph),
        )
        .route("/api/v1/activity", get(crate::local_api::list_activity))
        .route("/api/v1/org", get(crate::local_api::local_info))
        .route(
            "/api/v1/settings/thermo",
            get(crate::local_api::get_thermo_config).patch(crate::local_api::patch_thermo_config),
        )
        // Triggers — reactive memory automation (local + cloud parity)
        .route(
            "/api/v1/triggers",
            get(crate::local_api::list_triggers).post(crate::local_api::create_trigger),
        )
        .route(
            "/api/v1/triggers/:id",
            patch(crate::local_api::patch_trigger).delete(crate::local_api::delete_trigger),
        )
        .route(
            "/api/v1/triggers/history",
            get(crate::local_api::trigger_history),
        )
        // Paywalled cloud-only endpoints
        .route("/api/v1/keys", get(crate::local_api::upgrade_required))
        .route(
            "/api/v1/org/invite",
            post(crate::local_api::upgrade_required),
        )
        .route(
            "/api/v1/org/members",
            delete(crate::local_api::upgrade_required),
        )
        .route(
            "/api/v1/billing/create-checkout-session",
            post(crate::local_api::upgrade_required),
        )
        .route(
            "/api/v1/billing/create-portal-session",
            post(crate::local_api::upgrade_required),
        );

    let app = mcp_routes
        .merge(panel_routes)
        .route("/", get(crate::panel::index))
        .route("/favicon.svg", get(crate::panel::favicon))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = pick_mcp_addr();
    tracing::info!("Control panel: http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(wait_for_shutdown_signal())
        .await?;
    handle.abort();
    if db_url.is_none() {
        shutdown_embedded_postgres().await;
    }
    Ok(())
}

pub async fn serve_stdio(
    db_url: Option<&str>,
    interval_ms: u64,
    active_limit: usize,
) -> anyhow::Result<()> {
    let (storage, handle) = start_background(db_url, 0.85, 0.05, active_limit, interval_ms).await?;
    // McpHandler loads config (including storage limits) automatically
    let res = McpHandler::new(storage, create_embedder(), active_limit)
        .run_stdio_loop()
        .await;
    handle.abort();
    if db_url.is_none() {
        shutdown_embedded_postgres().await;
    }
    res
}

/// Compatibility shim — limits now come from Config, these params are ignored.
pub async fn serve_with_limits(
    db_url: Option<&str>,
    interval_ms: u64,
    active_limit: usize,
    _max_nodes: usize,
    _auto_prune_threshold: f32,
) -> anyhow::Result<()> {
    serve(db_url, interval_ms, active_limit).await
}

/// Compatibility shim — limits now come from Config, these params are ignored.
pub async fn serve_stdio_with_limits(
    db_url: Option<&str>,
    interval_ms: u64,
    active_limit: usize,
    _max_nodes: usize,
    _auto_prune_threshold: f32,
) -> anyhow::Result<()> {
    serve_stdio(db_url, interval_ms, active_limit).await
}
