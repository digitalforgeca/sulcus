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
    routing::{delete, get, patch, post, put},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::CorsLayer;
use tower_http::set_header::SetResponseHeaderLayer;

#[path = "build_stamp.rs"]
#[allow(dead_code)]
mod build_stamp;
pub mod activity;
pub mod agent;
pub mod auth;
pub mod billing;
pub mod db;
pub mod email;
pub mod encryption;
pub mod extensions;
pub mod gamification;
pub mod keycloak;
pub mod keys;
pub mod metrics;
pub mod middleware;
pub mod namespace;
pub mod org;
pub mod rate_limit;
pub mod remote_mcp;
pub mod status;
pub mod telemetry;
pub mod siru;
pub mod siu;
pub mod siu_v2;
pub mod thermo_api;
pub mod trigger_engine;
pub mod triggers;
pub mod waitlist;
pub mod worker;
pub mod curator;
pub mod entity_extraction;
pub mod graph;
pub mod output_evaluation;
pub mod password_reset;
pub mod registration;
pub mod temporal;

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

/// Shared application state injected into every Axum handler.
///
/// Intentionally minimal: all persistent data lives in the database.
/// The `pool` is the only shared resource; no in-memory caches.
#[derive(Clone)]
pub struct AppState {
    /// Connection pool to the backing database.
    /// Works with real Postgres **and** PGlite (same PostgreSQL wire protocol).
    pub pool: sqlx::PgPool,
    pub mcp_mgr: remote_mcp::McpManager,
    /// The public-facing URL of this server (used for Stripe redirects, etc.)
    pub public_url: String,
    /// Lazy-loaded embedding model for server-side semantic search.
    pub embedder: Arc<once_cell::sync::OnceCell<std::sync::Mutex<fastembed::TextEmbedding>>>,
    /// Optional SIU classifier for server-side memory type classification.
    pub siu_classifier: Option<Arc<siu::SiuClassifier>>,
    /// Optional SIU v2 ONNX classifier (SIVU quality gate + SICU type classifier).
    pub siu_v2_classifier: Option<Arc<siu_v2::SiuV2Classifier>>,
    /// Per-agent SIU v2 classifier cache. Key: "{tenant_id}/{agent_label}".
    /// Falls back to global siu_v2_classifier if no per-agent model found.
    pub siu_v2_agent_cache: dashmap::DashMap<String, Arc<siu_v2::SiuV2Classifier>>,
    /// Root directory for per-agent SIU model repos.
    pub siu_repos_dir: Option<String>,
    /// Optional entity extraction config (GPT-5.4-nano via Azure Foundry).
    /// When present, entity/relationship triples are extracted from memory
    /// content on the ingest path and stored as entities + golden_edges.
    pub extraction_config: Option<Arc<entity_extraction::ExtractionConfig>>,
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("pool", &"PgPool")
            .field("public_url", &self.public_url)
            .finish()
    }
}

impl AppState {
    /// Create `AppState` from an already-created pool (useful in tests).
    pub fn new(pool: sqlx::PgPool) -> Self {
        let siu_classifier = siu::SiuClassifier::try_new().map(Arc::new);
        let siu_v2_classifier = siu_v2::SiuV2Classifier::try_new();
        let siu_repos_dir = std::env::var("SIU_REPOS_DIR").ok();
        let extraction_config = entity_extraction::ExtractionConfig::from_env().map(Arc::new);

        // Startup diagnostic — clearly log classification engine state
        tracing::info!(
            siu_v1 = siu_classifier.is_some(),
            siu_v2_onnx = siu_v2_classifier.is_some(),
            silu_extraction = extraction_config.is_some(),
            "SIU startup: v1={}, v2-onnx={}, silu={}",
            if siu_classifier.is_some() { "json-loaded" } else { "unavailable" },
            if siu_v2_classifier.is_some() { "onnx-loaded" } else { "UNAVAILABLE — check SIU_V2_MODEL_DIR and ONNX models" },
            if extraction_config.is_some() { "enabled" } else { "disabled" },
        );
        Self {
            pool,
            mcp_mgr: remote_mcp::McpManager::new(),
            public_url: "http://localhost:3000".to_string(),
            embedder: Arc::new(once_cell::sync::OnceCell::new()),
            siu_classifier,
            siu_v2_classifier,
            siu_v2_agent_cache: dashmap::DashMap::new(),
            siu_repos_dir,
            extraction_config,
        }
    }

    /// Create `AppState` by connecting to `database_url` and running migrations.
    pub async fn connect(database_url: &str) -> anyhow::Result<Self> {
        use sqlx::postgres::PgConnectOptions;
        let connect_options: PgConnectOptions = database_url.parse()?;
        let connect_options = connect_options.statement_cache_capacity(0);

        let pool = PgPoolOptions::new()
            .max_connections(20)
            .min_connections(2)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(connect_options)
            .await?;

        db::run_migrations(&pool).await?;

        // Backfill existing BYTEA vectors → pgvector embeddings (idempotent, runs once)
        let backfill_pool = pool.clone();
        tokio::spawn(async move {
            match db::backfill_pgvector_embeddings(&backfill_pool).await {
                Ok(0) => tracing::debug!("pgvector backfill: no rows to migrate"),
                Ok(n) => tracing::info!(count = n, "pgvector backfill complete"),
                Err(e) => tracing::warn!(error = %e, "pgvector backfill failed (non-fatal, will retry on next restart)"),
            }
        });

        let public_url = std::env::var("SULCUS_PUBLIC_URL")
            .unwrap_or_else(|_| "http://localhost:3000".to_string());

        let siu_classifier = siu::SiuClassifier::try_new().map(Arc::new);
        let siu_v2_classifier = siu_v2::SiuV2Classifier::try_new();
        let siu_repos_dir = std::env::var("SIU_REPOS_DIR").ok();
        let extraction_config = entity_extraction::ExtractionConfig::from_env().map(Arc::new);

        // Startup diagnostic — clearly log classification engine state
        tracing::info!(
            siu_v1 = siu_classifier.is_some(),
            siu_v2_onnx = siu_v2_classifier.is_some(),
            silu_extraction = extraction_config.is_some(),
            "SIU startup: v1={}, v2-onnx={}, silu={}",
            if siu_classifier.is_some() { "json-loaded" } else { "unavailable" },
            if siu_v2_classifier.is_some() { "onnx-loaded" } else { "UNAVAILABLE — check SIU_V2_MODEL_DIR and ONNX models" },
            if extraction_config.is_some() { "enabled" } else { "disabled" },
        );

        if let Some(ref dir) = siu_repos_dir {
            tracing::info!(dir = %dir, "SIU per-agent repos enabled");
        }

        Ok(Self {
            pool,
            mcp_mgr: remote_mcp::McpManager::new(),
            public_url,
            embedder: Arc::new(once_cell::sync::OnceCell::new()),
            siu_classifier,
            siu_v2_classifier,
            siu_v2_agent_cache: dashmap::DashMap::new(),
            siu_repos_dir,
            extraction_config,
        })
    }

    /// Get or lazily initialize the embedding model (BGE-small-en-v1.5, 384-dim).
    /// Returns None if the model fails to load (non-fatal — falls back to text search).
    pub fn get_embedder(&self) -> Option<&std::sync::Mutex<fastembed::TextEmbedding>> {
        self.embedder.get_or_try_init(|| {
            tracing::info!("initializing embedding model (BGE-small-en-v1.5)...");
            let mut opts = fastembed::InitOptions::new(fastembed::EmbeddingModel::BGESmallENV15)
                .with_show_download_progress(false);
            // Respect FASTEMBED_CACHE_PATH if set (e.g. in Docker)
            if let Ok(cache_path) = std::env::var("FASTEMBED_CACHE_PATH") {
                tracing::info!(cache_path = %cache_path, "using custom fastembed cache path");
                opts = opts.with_cache_dir(std::path::PathBuf::from(cache_path));
            }
            let model = fastembed::TextEmbedding::try_new(
                opts,
            ).map_err(|e| {
                tracing::warn!(error = %e, "failed to load embedding model — semantic search unavailable");
                e
            })?;
            tracing::info!("embedding model loaded");
            Ok::<_, anyhow::Error>(std::sync::Mutex::new(model))
        }).ok()
    }

    /// Embed a text query into a vector. Returns None on failure.
    pub fn embed_query(&self, text: &str) -> Option<Vec<f32>> {
        let embedder = self.get_embedder()?;
        let mut model = embedder.lock().ok()?;
        model.embed(vec![text], None).ok()?.into_iter().next()
    }

    /// Classify memory text using SIU (single best type). Returns None if SIU
    /// unavailable or confidence is below threshold.
    pub fn classify_memory(&self, text: &str) -> Option<siu::Classification> {
        let classifier = self.siu_classifier.as_ref()?;
        let embedding = self.embed_query(text)?;
        classifier.classify(&embedding)
    }

    /// Multi-label classification. Returns all matching types above threshold.
    pub fn classify_memory_multi(&self, text: &str) -> Option<siu::MultiClassification> {
        let classifier = self.siu_classifier.as_ref()?;
        let embedding = self.embed_query(text)?;
        classifier.classify_multi(&embedding)
    }

    /// Whether the SIU classifier is loaded and available.
    pub fn siu_available(&self) -> bool {
        self.siu_classifier.is_some()
    }

    /// Whether SIU v2 (ONNX) is available.
    pub fn siu_v2_available(&self) -> bool {
        self.siu_v2_classifier.is_some()
    }

    /// Get the SIU v2 classifier for a specific agent, with caching.
    /// Resolution order:
    /// 1. Per-agent model from SIU_REPOS_DIR/{tenant}/{agent}/
    /// 2. Global SIU v2 classifier (SIU_V2_MODEL_DIR)
    /// 3. None
    pub fn get_agent_siu_v2(
        &self,
        tenant_id: &str,
        agent_label: &str,
    ) -> Option<Arc<siu_v2::SiuV2Classifier>> {
        // Only check per-agent repos if configured
        if let Some(ref repos_dir) = self.siu_repos_dir {
            if !agent_label.is_empty() {
                let cache_key = format!("{}/{}", tenant_id, agent_label);

                // Check cache first
                if let Some(cached) = self.siu_v2_agent_cache.get(&cache_key) {
                    return Some(cached.clone());
                }

                // Try loading from per-agent repo
                let agent_dir = std::path::Path::new(repos_dir)
                    .join(tenant_id)
                    .join(agent_label);

                if agent_dir.exists() {
                    if let Some(classifier) = siu_v2::SiuV2Classifier::try_from_dir(&agent_dir) {
                        self.siu_v2_agent_cache.insert(cache_key, classifier.clone());
                        return Some(classifier);
                    }
                }
            }
        }

        // Fall back to global classifier
        self.siu_v2_classifier.clone()
    }

    /// Classify memory text using SIU v2 (ONNX).
    /// Falls back to v1 if v2 is not available.
    /// NOTE: Callers should check siu_v2_available() if they need to know which engine
    /// actually served the result — this method transparently wraps v1 as v2.
    pub fn classify_memory_v2(&self, text: &str) -> Option<siu_v2::SiuV2Result> {
        if let Some(ref v2) = self.siu_v2_classifier {
            return v2.classify(text);
        }
        // Fall back to v1 (JSON model weights)
        let v1 = self.classify_memory(text)?;
        tracing::debug!("SIU: v2 ONNX unavailable, falling back to v1 JSON classifier");
        Some(siu_v2::SiuV2Result {
            quality: "store".to_string(), // v1 doesn't have quality gate
            quality_confidence: 1.0,
            memory_type: Some(v1.memory_type),
            type_confidence: Some(v1.confidence),
            type_probabilities: None,
        })
    }

    /// Whether the embedding model is loaded and available.
    pub fn embedder_available(&self) -> bool {
        self.embedder.get().is_some()
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
        .route("/api/v1/agent/evaluate-output", post(output_evaluation::evaluate_output))
        .route("/api/v1/agent/hot-context", post(agent::handle_hot_context))
        .route("/api/v1/agent/entity-context", post(agent::handle_entity_context))
        .route("/api/v1/agent/memory/status", get(agent::handle_memory_status))
        .route("/api/v1/agent/backfill-embeddings", post(agent::handle_backfill_embeddings))
        .route("/api/v1/agent/backfill-utility", post(agent::handle_backfill_utility))
        .route("/api/v1/agent/siu-model", get(extensions::get_siu_model))
        .route("/api/v1/agent/fold", post(agent::handle_fold))
        .route("/api/v1/agent/consolidation-candidates", get(agent::consolidation_candidates))
        .route("/api/v1/agent/consolidate", post(agent::consolidate_memories))
        .route("/api/v1/agent/restore", post(agent::restore_memories))
        .route("/api/v1/agent/archive", get(agent::list_archived))
        .route("/api/v1/agent/conflicts", get(agent::list_conflicts))
        .route("/api/v1/agent/conflicts/:id", patch(agent::resolve_conflict))
        .route("/api/v1/auth/verify", get(agent::handle_auth_verify))
        .route("/api/v1/agent/storage", get(agent::storage_status))
        // SIRU — Recall Unit
        .route("/api/v1/agent/recall-log", post(siru::log_recall_session))
        .route("/api/v1/agent/recall-feedback", post(siru::recall_feedback))
        .route("/api/v1/agent/recall-weights", get(siru::get_recall_weights))
        // AGE graph validation endpoints
        .route("/api/v1/agent/graph/status", get(graph::handle_graph_status))
        .route("/api/v1/agent/graph/neighbors/:id", get(graph::handle_graph_neighbors))
        .route("/api/v1/agent/graph/temporal", post(graph::handle_temporal_query))
        .route("/api/v1/agent/graph/verify/:id", get(graph::handle_graph_verify))
        .route("/api/v1/admin/dashboard", get(agent::dashboard_stats))
        .route("/api/v1/admin/invite", post(agent::handle_invite))
        .route("/api/v1/admin/invite/send", post(agent::handle_invite_send))
        .route("/api/v1/admin/invite/platform", post(agent::handle_platform_invite))
        .route("/api/v1/admin/usage", get(agent::handle_usage))
        // Namespace ACL
        .route("/api/v1/namespaces/acl", get(namespace::list_acl).post(namespace::upsert_acl))
        .route("/api/v1/namespaces/acl/:id", delete(namespace::delete_acl))
        .route("/api/v1/namespaces/default", put(namespace::set_default))
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
        .route("/api/v1/keys/:id", delete(keys::revoke_key).patch(keys::update_key))
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
        .route(
            "/api/v1/settings/siu",
            get(siu::get_siu_config).patch(siu::update_siu_config),
        )
        .route(
            "/api/v1/settings/siu/:namespace",
            get(siu::get_agent_siu_config)
                .patch(siu::update_agent_siu_config)
                .delete(siu::delete_agent_siu_config),
        )
        .route("/api/v1/feedback", post(thermo_api::post_feedback))
        // SIU v2 — SIVU + SICU with training signal feedback loop
        .route("/api/v2/siu/label", post(siu_v2::label))
        .route("/api/v2/siu/classify", post(siu_v2::label))  // alias — classify = label
        .route("/api/v2/siu/signal", post(siu_v2::record_signal))
        .route("/api/v2/siu/signals", get(siu_v2::list_signals))
        .route("/api/v2/siu/status", get(siu_v2::status))
        .route("/api/v2/siu/retrain", post(siu_v2::retrain))
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
        .route("/api/v1/triggers/evaluate", post(triggers::evaluate_triggers))
        .route(
            "/api/v1/triggers/feedback",
            get(triggers::list_trigger_feedback).post(triggers::record_trigger_feedback),
        )
        .route(
            "/api/v1/triggers/:id",
            patch(triggers::update_trigger).delete(triggers::delete_trigger),
        )
        // Encryption — Customer-Managed Keys (enterprise)
        .route(
            "/api/v1/settings/encryption",
            get(encryption::get_encryption_config)
                .put(encryption::configure_encryption)
                .delete(encryption::revoke_encryption),
        )
        .route(
            "/api/v1/settings/encryption/validate",
            post(encryption::validate_encryption),
        )
        .route(
            "/api/v1/settings/encryption/audit",
            get(encryption::encryption_audit_log),
        )
        .route("/api/v1/extensions/sync", get(extensions::get_extension))
        .route("/api/v1/extensions/:component", get(extensions::get_extension_by_component))
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
        .route("/", get(|| async {
            format!("SULCUS Server Active v{}", env!("CARGO_PKG_VERSION"))
        }))
        .route("/api/v1/admin/join", post(agent::handle_join))
        .route("/api/v1/register", post(registration::handle_register))
        .route("/api/v1/forgot-password", post(password_reset::handle_forgot_password))
        .route("/api/v1/reset-password", post(password_reset::handle_reset_password))
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
        // Security headers
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::STRICT_TRANSPORT_SECURITY,
            axum::http::HeaderValue::from_static("max-age=63072000; includeSubDomains; preload"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::X_CONTENT_TYPE_OPTIONS,
            axum::http::HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::X_FRAME_OPTIONS,
            axum::http::HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::REFERRER_POLICY,
            axum::http::HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::HeaderName::from_static("permissions-policy"),
            axum::http::HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::HeaderName::from_static("x-dns-prefetch-control"),
            axum::http::HeaderValue::from_static("off"),
        ))
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

    // Eagerly initialize the embedder so any failures are visible in startup logs.
    if state.get_embedder().is_some() {
        tracing::info!("embedder ready — inline embedding enabled for new memories");
    } else {
        tracing::warn!("embedder NOT available — new memories will lack vectors until backfill. Semantic search degraded.");
    }

    // Spawn background worker (decay, active index rebuild, edge generation)
    worker::spawn(state.pool.clone());

    // Spawn SIU curation cycle (reclassify, consolidate, summarize, re-vectorize)
    curator::spawn(state.pool.clone());

    Ok(make_app_with_state(state))
}
