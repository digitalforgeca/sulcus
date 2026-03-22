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
    routing::{delete, get, patch, post},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::CorsLayer;

pub mod activity;
pub mod agent;
pub mod auth;
pub mod billing;
pub mod db;
pub mod extensions;
pub mod gamification;
pub mod keycloak;
pub mod keys;
pub mod metrics;
pub mod middleware;
pub mod org;
pub mod rate_limit;
pub mod remote_mcp;
pub mod status;
pub mod telemetry;
pub mod thermo_api;
pub mod trigger_engine;
pub mod triggers;
pub mod waitlist;
pub mod worker;

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
    use axum::http::Method;
    use std::time::Duration;
    use tower_http::limit::RequestBodyLimitLayer;

    // Initialize optional Prometheus exporter (idempotent).
    let _ = crate::metrics::init_from_env().ok();

    // -----------------------------------------------------------------------
    // Rate limiters
    // -----------------------------------------------------------------------
    // Public routes: 30 req/min per IP (generous for dashboard, tight enough to stop abuse)
    let public_limiter = Arc::new(rate_limit::RateLimiter::new(30, 0, Duration::from_secs(60)));
    // Authenticated routes: 300 req/min per tenant (5/sec sustained)
    let tenant_limiter = Arc::new(rate_limit::RateLimiter::new(0, 300, Duration::from_secs(60)));

    // -----------------------------------------------------------------------
    // Authenticated API routes (require API key or OIDC JWT)
    // -----------------------------------------------------------------------
    let api_routes = Router::new()
        .route("/api/v1/agent/sync", post(agent::handle_sync))
        .route("/api/v1/agent/hot_nodes", get(agent::list_hot_nodes))
        .route(
            "/api/v1/agent/nodes",
            get(agent::list_memories).post(agent::create_memory),
        )
        .route(
            "/api/v1/agent/nodes/bulk",
            post(agent::bulk_delete_memories),
        )
        .route(
            "/api/v1/agent/nodes/bulk-patch",
            post(agent::bulk_patch_memories),
        )
        .route(
            "/api/v1/agent/nodes/:id",
            get(agent::get_memory)
                .delete(agent::delete_memory)
                .patch(agent::patch_memory),
        )
        .route("/api/v1/agent/search", post(agent::handle_text_search))
        .route("/api/v1/agent/storage", get(agent::storage_status))
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
        .route(
            "/api/v1/activity",
            get(activity::list_activity).post(activity::record_activity),
        )
        .route(
            "/api/v1/gamification/profile",
            get(gamification::get_profile),
        )
        .route(
            "/api/v1/settings/thermo",
            get(thermo_api::get_thermo_config).patch(thermo_api::update_thermo_config),
        )
        .route("/api/v1/feedback", post(thermo_api::post_feedback))
        .route(
            "/api/v1/analytics/recall",
            get(thermo_api::get_recall_analytics),
        )
        .route("/api/v1/admin/telemetry", get(telemetry::telemetry_stats))
        // Triggers — reactive memory automation
        .route(
            "/api/v1/triggers",
            get(triggers::list_triggers).post(triggers::create_trigger),
        )
        .route("/api/v1/triggers/history", get(triggers::trigger_history))
        .route(
            "/api/v1/triggers/:id",
            patch(triggers::update_trigger).delete(triggers::delete_trigger),
        )
        .route("/api/v1/extensions/sync", get(extensions::get_extension))
        // Per-tenant rate limiting (applied after auth extracts TenantContext)
        .layer(from_fn_with_state(
            Arc::clone(&tenant_limiter),
            rate_limit::rate_limit_by_tenant,
        ))
        .layer(from_fn_with_state(
            Arc::clone(&state),
            middleware::require_agent_api_key,
        ));

    // Waitlist admin view (behind auth)
    let api_routes = api_routes.route("/api/v1/admin/waitlist", get(waitlist::list_waitlist));

    // -----------------------------------------------------------------------
    // Public routes (no auth, IP-based rate limiting)
    // -----------------------------------------------------------------------
    let public_routes = Router::new()
        .route("/", get(|| async { "SULCUS Server Active" }))
        .route("/api/v1/admin/join", post(agent::handle_join))
        .route("/api/v1/waitlist", post(waitlist::join_waitlist))
        .route(
            "/api/v1/billing/stripe-webhook",
            post(billing::stripe_webhook),
        )
        .route("/api/v1/billing/products", get(billing::get_products))
        .route("/api/v1/telemetry", post(telemetry::ingest_telemetry))
        .route("/api/v1/status", get(status::public_status))
        .layer(from_fn_with_state(
            Arc::clone(&public_limiter),
            rate_limit::rate_limit_by_ip,
        ));

    // -----------------------------------------------------------------------
    // MCP routes (require paid tier)
    // -----------------------------------------------------------------------
    let mcp_routes = Router::new()
        // Legacy SSE transport (pre-2025 MCP spec)
        .route("/api/v1/mcp/sse", get(remote_mcp::sse_handler))
        .route("/api/v1/mcp/message", post(remote_mcp::message_handler))
        // Streamable HTTP transport (MCP 2025-06-18 spec, used by Claude web)
        .route(
            "/mcp",
            get(remote_mcp::streamable_get)
                .post(remote_mcp::streamable_post)
                .delete(remote_mcp::streamable_delete),
        )
        .layer(from_fn_with_state(
            Arc::clone(&state),
            middleware::require_team_tier,
        ));

    // -----------------------------------------------------------------------
    // CORS: restricted origins, specific methods and headers
    // -----------------------------------------------------------------------
    let allowed_origins = std::env::var("SULCUS_CORS_ORIGINS")
        .unwrap_or_else(|_| "https://sulcus.ca,https://www.sulcus.ca,https://sulcus.dforge.ca,https://sulcus-web.calmstone-a7a24a97.westus.azurecontainerapps.io,http://localhost:3000,https://claude.ai".to_string());
    let origins: Vec<_> = allowed_origins
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
            // MCP streamable transport uses Mcp-Session-Id
            "Mcp-Session-Id".parse().unwrap(),
            "Last-Event-ID".parse().unwrap(),
        ])
        .expose_headers([
            "Mcp-Session-Id".parse().unwrap(),
        ]);

    // -----------------------------------------------------------------------
    // Assemble with global body size limit
    // -----------------------------------------------------------------------
    // 2 MB default — generous for sync payloads with embeddings.
    // Stripe webhooks can be up to 64KB. Telemetry is tiny.
    // Sync payloads with vectors can be 500KB–1MB for large batches.
    Router::new()
        .merge(api_routes)
        .merge(mcp_routes)
        .merge(public_routes)
        .layer(cors)
        .layer(RequestBodyLimitLayer::new(2 * 1024 * 1024)) // 2 MB
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

    // Spawn background worker (decay, active index rebuild, edge generation)
    worker::spawn(state.pool.clone());

    Ok(make_app_with_state(state))
}
