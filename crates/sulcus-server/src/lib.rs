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
    routing::{delete, get, post},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::CorsLayer;

pub mod agent;
pub mod auth;
pub mod billing;
pub mod db;
pub mod keycloak;
pub mod keys;
pub mod metrics;
pub mod middleware;
pub mod org;
pub mod remote_mcp;

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
    /// The public-facing URL of this server (used for Stripe redirects, etc.)
    pub public_url: String,
}

impl AppState {
    /// Create `AppState` from an already-created pool (useful in tests).
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self {
            pool,
            mcp_mgr: remote_mcp::McpManager::new(),
            public_url: "http://localhost:3000".to_string(),
        }
    }

    /// Create `AppState` by connecting to `database_url` and running migrations.
    pub async fn connect(database_url: &str) -> anyhow::Result<Self> {
        use sqlx::postgres::PgConnectOptions;
        let connect_options: PgConnectOptions = database_url.parse()?;
        let connect_options = connect_options.statement_cache_capacity(0);

        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect_with(connect_options)
            .await?;

        db::run_migrations(&pool).await?;

        let public_url = std::env::var("SULCUS_PUBLIC_URL")
            .unwrap_or_else(|_| "http://localhost:3000".to_string());

        Ok(Self {
            pool,
            mcp_mgr: remote_mcp::McpManager::new(),
            public_url,
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
        .route("/api/v1/agent/nodes", get(agent::list_memories))
        .route(
            "/api/v1/agent/nodes/bulk",
            post(agent::bulk_delete_memories),
        )
        .route(
            "/api/v1/agent/nodes/:id",
            delete(agent::delete_memory).patch(agent::patch_memory),
        )
        .route("/api/v1/admin/dashboard", get(agent::dashboard_stats))
        .route("/api/v1/admin/invite", post(agent::handle_invite))
        .route("/api/v1/admin/usage", get(agent::handle_usage))
        .route(
            "/api/v1/admin/visualize/graph",
            get(agent::handle_visualize_graph),
        )
        .route("/api/v1/metrics", get(agent::metrics))
        .route(
            "/api/v1/billing/create-checkout-session",
            post(billing::create_checkout_session),
        )
        .route(
            "/api/v1/billing/create-subscription",
            post(billing::create_subscription),
        )
        .route(
            "/api/v1/billing/create-portal-session",
            post(billing::create_portal_session),
        )
        .route("/api/v1/org", get(org::get_org).patch(org::update_org))
        .route("/api/v1/org/invite", post(org::invite_member))
        .route("/api/v1/org/members", delete(org::remove_member))
        .route("/api/v1/keys", get(keys::list_keys).post(keys::create_key))
        .route("/api/v1/keys/:id", delete(keys::revoke_key))
        .layer(from_fn_with_state(
            Arc::clone(&state),
            middleware::require_agent_api_key,
        ));

    let public_routes = Router::new()
        .route("/", get(|| async { "SULCUS Server Active" }))
        .route("/api/v1/admin/join", post(agent::handle_join))
        .route(
            "/api/v1/billing/stripe-webhook",
            post(billing::stripe_webhook),
        )
        .route("/api/v1/billing/products", get(billing::get_products));

    let mcp_routes = Router::new()
        .route("/api/v1/mcp/sse", get(remote_mcp::sse_handler))
        .route("/api/v1/mcp/message", post(remote_mcp::message_handler))
        .layer(from_fn_with_state(
            Arc::clone(&state),
            middleware::require_team_tier,
        ));

    // CORS: allow the web dashboard and localhost origins.
    // Configurable via SULCUS_CORS_ORIGINS env var (comma-separated).
    let allowed_origins = std::env::var("SULCUS_CORS_ORIGINS")
        .unwrap_or_else(|_| "https://sulcus.dforge.ca,https://sulcus-web.calmstone-a7a24a97.westus.azurecontainerapps.io,http://localhost:3000".to_string());
    let origins: Vec<_> = allowed_origins
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any)
        .expose_headers(tower_http::cors::Any);

    Router::new()
        .merge(api_routes)
        .merge(mcp_routes)
        .merge(public_routes)
        .layer(cors)
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
