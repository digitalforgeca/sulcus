//! sulcus-server – database-first agent sync server
//!
//! All state is persisted to a PostgreSQL-compatible database.  In production
//! this is real Postgres.  During development and in the VS Code extension it
//! is a PGlite instance (started by `@sulcus/pglite-server`) that speaks the
//! standard PostgreSQL wire protocol on a local port.
//!
//! There is intentionally **no in-memory HashMap fallback**.  Every request
//! reads and writes through the database so the server is stateless and can
//! be horizontally scaled or restarted without losing data.

use std::sync::Arc;

use axum::{
    middleware::from_fn_with_state,
    routing::{get, post},
    Router,
};
use sqlx::postgres::PgPoolOptions;

pub mod agent;
pub mod db;
pub mod metrics;
pub mod middleware;
pub mod auth;
pub mod remote_mcp;
pub mod billing;

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

/// Shared application state injected into every Axum handler.
///
/// Intentionally minimal: all persistent data lives in the database.
/// The `pool` is the only shared resource; no in-memory caches.
#[derive(Clone, Debug)]
pub struct AppState {
    /// Connection pool to the backing database.
    /// Works with real Postgres **and** PGlite (same PostgreSQL wire protocol).
    pub pool: sqlx::PgPool,
    pub mcp_mgr: remote_mcp::McpManager,
}

impl AppState {
    /// Create `AppState` from an already-created pool (useful in tests).
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self { 
            pool,
            mcp_mgr: remote_mcp::McpManager::new(),
        }
    }

    /// Create `AppState` by connecting to `database_url` and running migrations.
    pub async fn connect(database_url: &str) -> anyhow::Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(database_url)
            .await?;

        db::run_migrations(&pool).await?;

        Ok(Self { 
            pool,
            mcp_mgr: remote_mcp::McpManager::new(),
        })
    }
}

pub type SharedState = Arc<AppState>;

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/// Build a router wired to the provided `state`.
///
/// Useful in tests: create an isolated `AppState` with a test-schema pool and
/// pass it here to get a fully-functional router without spawning a real server.
pub fn make_app_with_state(state: SharedState) -> Router {
    // Initialize optional Prometheus exporter (idempotent).
    let _ = crate::metrics::init_from_env().ok();

    let api_routes = Router::new()
        .route("/api/v1/agent/sync", post(agent::handle_sync))
        .route("/api/v1/agent/hot_nodes", get(agent::list_hot_nodes))
        .route("/api/v1/admin/invite", post(agent::handle_invite))
        .route("/api/v1/admin/usage", get(agent::handle_usage))
        .route("/api/v1/admin/visualize/graph", get(agent::handle_visualize_graph))
        .route("/api/v1/metrics", get(agent::metrics))
        .route("/api/v1/billing/create-checkout-session", post(billing::create_checkout_session))
        .layer(from_fn_with_state(Arc::clone(&state), middleware::require_agent_api_key));

    let public_routes = Router::new()
        .route("/", get(|| async { "SULCUS Server Active" }))
        .route("/api/v1/admin/join", post(agent::handle_join))
        .route("/api/v1/billing/stripe-webhook", post(billing::stripe_webhook));

    let mcp_routes = Router::new()
        .route("/api/v1/mcp/sse", get(remote_mcp::sse_handler))
        .route("/api/v1/mcp/message", post(remote_mcp::message_handler))
        .layer(from_fn_with_state(Arc::clone(&state), middleware::require_team_tier));

    Router::new()
        .merge(api_routes)
        .merge(mcp_routes)
        .merge(public_routes)
        .with_state(state)
}

/// Convenience factory: reads `SULCUS_DATABASE_URL` from the environment, connects
/// (to real Postgres **or** a local PGlite server), runs migrations, and
/// returns a ready router.
///
/// Default URL (matches `@sulcus/pglite-server` defaults):
///   `postgres://sulcus@127.0.0.1:4201/sulcus`
pub async fn make_app() -> anyhow::Result<Router> {
    let db_url = std::env::var("SULCUS_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://sulcus@127.0.0.1:4201/sulcus".to_string());

    tracing::info!(db_url = %db_url, "connecting to database (PGlite or Postgres)");

    let state = Arc::new(AppState::connect(&db_url).await?);
    Ok(make_app_with_state(state))
}
