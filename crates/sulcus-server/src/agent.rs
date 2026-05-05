use axum::{
    extract::{Extension, Json, Query, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use sulcus_core::sync::MemoryOp;

use pgvector::Vector;

/// POST /api/v1/agent/embed
/// Embed a single text string using the server-side embedding model (BGE-small-en-v1.5).
/// Returns the embedding vector, model name, and dimensions.
/// Used by OpenClaw's memoryEmbeddingProvider contract.
#[derive(Deserialize)]
pub struct EmbedRequest {
    pub text: String,
    #[serde(default)]
    pub namespace: Option<String>,
}

pub async fn handle_embed(
    State(state): State<crate::SharedState>,
    Extension(_tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(body): Json<EmbedRequest>,
) -> impl IntoResponse {
    if body.text.is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "text is required" })),
        ).into_response();
    }
    match state.embed_query(&body.text) {
        Some(embedding) => {
            let dimensions = embedding.len();
            Json(serde_json::json!({
                "embedding": embedding,
                "model": "bge-small-en-v1.5",
                "dimensions": dimensions,
            })).into_response()
        }
        None => (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "embedding model not available",
                "model": "bge-small-en-v1.5",
            })),
        ).into_response(),
    }
}

/// GET /api/v1/agent/memory/status
/// Returns full provenance and capability info for the calling agent.
pub async fn handle_memory_status(
    State(state): State<crate::SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id.clone();
    let agent_label = tenant_ctx.agent_label.clone();
    let namespace = tenant_ctx.effective_namespace();

    // Count memories in this namespace
    let memory_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM golden_index WHERE tenant_id = $1 AND namespace = $2"
    )
    .bind(&tenant_id)
    .bind(&namespace)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    // Count total memories for tenant
    let total_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM golden_index WHERE tenant_id = $1"
    )
    .bind(&tenant_id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    Json(serde_json::json!({
        "status": "connected",
        "version": env!("CARGO_PKG_VERSION"),
        "backend": "cloud",
        "server": "api.sulcus.ca",
        "storage": "postgres",
        "tenant_id": tenant_id,
        "agent_label": agent_label,
        "namespace": namespace,
        "capabilities": {
            "siu_classification": state.siu_available() || state.siu_v2_available(),
            "siu_v2": state.siu_v2_available(),
            "semantic_search": state.embedder_available(),
            "cloud_sync": false,
            "triggers": true,
            "thermodynamics": true,
            "age_graph": crate::graph::graph_available(&state.pool).await,
        },
        "stats": {
            "namespace_memories": memory_count,
            "tenant_total_memories": total_count,
        }
    }))
}

use crate::SharedState;

/// Whitelisted memory types. Reject anything else on create.
const VALID_MEMORY_TYPES: &[&str] = &[
    "episodic", "semantic", "procedural", "preference", "fact", "moment", "synthesis",
];

/// Maximum ops per sync request.
const MAX_SYNC_OPS: usize = 1000;

#[derive(Deserialize)]
pub struct SyncRequest {
    pub ops: Vec<MemoryOp>,
    pub last_cursor: Option<String>,
}

#[derive(Serialize)]
pub struct SyncResponse {
    pub new_ops: Vec<MemoryOp>,
    pub new_cursor: String,
    /// Durable server cursor (seq id) for clients that support seq-based cursors.
    pub new_cursor_seq: Option<i64>,
}

/// Accept client WAL ops, persist them (idempotent), and return ops the client
/// hasn't seen yet.  All reads/writes go through the database — no in-memory
/// HashMap fallback.  The database may be real Postgres or a PGlite instance
/// speaking the same wire protocol.
pub async fn handle_sync(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<SyncRequest>,
) -> impl IntoResponse {
    let t0 = std::time::Instant::now();
    let pool = &state.pool;

    // Enforce namespace suspension — block writes when namespace is suspended.
    // Reads are unaffected so recalled memories are still accessible.
    // Only skip this check when the request has no write ops (pure pull).
    let has_write_ops = !req.ops.is_empty();
    if has_write_ops {
        let agent_ns = tenant_ctx.effective_namespace();
        let suspended_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
            "SELECT suspended_at FROM namespace_counters \
             WHERE tenant_id = $1 AND namespace = $2 AND suspended_at IS NOT NULL"
        )
        .bind(&tenant_ctx.id)
        .bind(&agent_ns)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten();

        if let Some(since) = suspended_at {
            tracing::warn!(
                tenant = %tenant_ctx.id,
                namespace = %agent_ns,
                suspended_since = %since,
                "write blocked: namespace is suspended"
            );
            return (
                axum::http::StatusCode::FORBIDDEN,
                Json(SyncResponse {
                    new_ops: Vec::new(),
                    new_cursor: chrono::Utc::now().to_rfc3339(),
                    new_cursor_seq: None,
                }),
            );
        }
    }

    // Enforce batch size limit
    if req.ops.len() > MAX_SYNC_OPS {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(SyncResponse {
                new_ops: Vec::new(),
                new_cursor: chrono::Utc::now().to_rfc3339(),
                new_cursor_seq: None,
            }),
        );
    }

    // Enforce tier-based ops limit (always, not just when ops_limit is set)
    let limit = tenant_ctx.effective_ops_limit();
    let tenant_id = tenant_ctx.id;
    let current_usage: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(sync_requests), 0) FROM tenant_usage WHERE tenant_id = $1 AND month = date_trunc('month', now())::date"
    )
    .bind(&tenant_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if current_usage >= limit {
        tracing::warn!(tenant_id = %tenant_id, limit, current_usage, tier = %tenant_ctx.plan_tier, "tenant exceeded ops limit");
        return (
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            // Note: Retry-After header would need to be set at the response layer.
            // The JSON body includes the limit info for client diagnostics.
            Json(SyncResponse {
                new_ops: Vec::new(),
                new_cursor: chrono::Utc::now().to_rfc3339(),
                new_cursor_seq: None,
            }),
        );
    }

    // Persist incoming ops and update golden_index (idempotent upsert).
    if !req.ops.is_empty() {
        if let Err(e) = crate::db::persist_ops_and_upsert_golden(pool, &tenant_id, &req.ops).await {
            tracing::error!(error = %e, "failed to persist ops");
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(SyncResponse {
                    new_ops: Vec::new(),
                    new_cursor: chrono::Utc::now().to_rfc3339(),
                    new_cursor_seq: None,
                }),
            );
        }

        // Award XP and log activity for sync + any Add ops (fire-and-forget).
        {
            let add_count = req
                .ops
                .iter()
                .filter(|o| matches!(o.op, sulcus_core::sync::OpType::Add))
                .count() as i32;
            let ops_total = req.ops.len() as i32;
            let pool_clone = pool.clone();
            let tid = tenant_id.clone();
            tokio::spawn(async move {
                let _ = crate::gamification::award_xp(&pool_clone, &tid, "sync", 2).await;
                let _ = crate::activity::log_activity(
                    &pool_clone,
                    &tid,
                    "agent",
                    "sync",
                    None,
                    None,
                    Some(serde_json::json!({"ops": ops_total, "adds": add_count})),
                )
                .await;
                for _ in 0..add_count {
                    let _ =
                        crate::gamification::award_xp(&pool_clone, &tid, "memory.add", 10).await;
                }
            });
        }
    }

    // Resolve the client's cursor to a timestamp for the pull query.
    let since_ts: Option<chrono::DateTime<chrono::Utc>> = req
        .last_cursor
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    // Resolve team members for cross-tenant read sharing (falls back to [self]).
    let pull_tenants = crate::db::fetch_team_tenant_ids(pool, &tenant_id)
        .await
        .unwrap_or_else(|_| vec![tenant_id.clone()]);

    // Fetch ops that the client hasn't seen yet.
    let (new_ops, latest_seq) =
        match crate::db::fetch_ops_and_cursor(pool, &pull_tenants, since_ts).await {
            Ok(result) => result,
            Err(e) => {
                tracing::error!(error = %e, "failed to fetch ops");
                return (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(SyncResponse {
                        new_ops: Vec::new(),
                        new_cursor: chrono::Utc::now().to_rfc3339(),
                        new_cursor_seq: None,
                    }),
                );
            }
        };

    // Update Prometheus metrics (idempotent, fire-and-forget).
    if let Some(m) = crate::metrics::try_get() {
        let golden_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM golden_index WHERE tenant_id = $1")
                .bind(&tenant_id)
                .fetch_one(pool)
                .await
                .unwrap_or(0);
        let ops_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM server_ops WHERE tenant_id = $1")
                .bind(&tenant_id)
                .fetch_one(pool)
                .await
                .unwrap_or(0);
        let db_size: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
            .fetch_one(pool)
            .await
            .unwrap_or(0);
        m.golden_index_size.set(golden_count as f64);
        m.server_ops_in_wal.set(ops_count as f64);
        m.db_size_bytes.set(db_size as f64);
        m.pg_enabled.set(1.0);
    }

    // Fire-and-forget usage tracking for billing.
    {
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let add_count = req
            .ops
            .iter()
            .filter(|o| matches!(o.op, sulcus_core::sync::OpType::Add))
            .count() as i64;
        let pool_clone = pool.clone();
        let tid = tenant_id.clone();
        tokio::spawn(async move {
            if let Err(e) =
                crate::db::increment_usage(&pool_clone, &tid, 1, add_count, elapsed_ms).await
            {
                tracing::warn!(error = %e, "failed to record usage");
            }
        });
    }

    (
        axum::http::StatusCode::OK,
        Json(SyncResponse {
            new_ops,
            new_cursor: chrono::Utc::now().to_rfc3339(),
            new_cursor_seq: latest_seq,
        }),
    )
}

#[derive(Deserialize)]
pub struct HotNodesQuery {
    pub limit: Option<u32>,
    /// Namespace to scope hot nodes to. Defaults to the agent's own namespace.
    /// Pass `namespace=*` to query all accessible namespaces (ACL enforced).
    pub namespace: Option<String>,
}

/// Return top `limit` nodes ordered by `current_heat DESC` from the golden index.
/// By default, scoped to the agent's own namespace. Use `?namespace=*` for cross-namespace.
pub async fn list_hot_nodes(
    State(state): State<crate::SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Query(params): Query<HotNodesQuery>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20) as i64;
    let pool = &state.pool;
    let tenant_id = tenant_ctx.id.clone();

    let pull_tenants = crate::db::fetch_team_tenant_ids(pool, &tenant_id)
        .await
        .unwrap_or_else(|_| vec![tenant_id.clone()]);

    let acl = crate::db::load_namespace_acl(pool, &tenant_id, &tenant_ctx.agent_label).await;

    // Default namespace = agent's own label (or "default" if no label).
    // `namespace=*` means "all accessible namespaces".
    let params_ns = crate::middleware::sanitize_ns_opt(params.namespace);
    let requested_ns = params_ns.as_deref().unwrap_or("");
    let scope_all = requested_ns == "*";
    let agent_ns = tenant_ctx.effective_namespace();

    // Determine the effective namespace filter BEFORE the DB query
    let ns_filter: Option<String> = if scope_all {
        None // fetch all, then ACL-filter
    } else if requested_ns.is_empty() {
        Some(agent_ns.clone()) // agent's own namespace
    } else if acl.is_allowed(requested_ns) {
        Some(requested_ns.to_string()) // explicit namespace, ACL-checked
    } else {
        return (axum::http::StatusCode::OK, Json(Vec::<sulcus_core::graph::Node>::new()));
    };

    match crate::db::fetch_top_hot_nodes_ns(pool, &pull_tenants, ns_filter.as_deref(), limit).await {
        Ok(nodes) => {
            let filtered: Vec<_> = if scope_all {
                // Cross-namespace: ACL filter post-query
                nodes.into_iter().filter(|n| acl.is_allowed(&n.namespace)).collect()
            } else {
                nodes // Already namespace-filtered by SQL
            };
            (axum::http::StatusCode::OK, Json(filtered))
        },
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch hot nodes");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(Vec::<sulcus_core::graph::Node>::new()),
            )
        }
    }
}

/// Server health + metrics (golden index size, WAL depth, DB size).
pub async fn metrics(
    State(state): State<crate::SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant_id = tenant_ctx.id;

    let golden_index_size: i64 =
        sqlx::query_scalar("SELECT count(*) FROM golden_index WHERE tenant_id = $1")
            .bind(&tenant_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    let server_ops_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM server_ops WHERE tenant_id = $1")
            .bind(&tenant_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    let db_size_bytes: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    if let Some(m) = crate::metrics::try_get() {
        m.golden_index_size.set(golden_index_size as f64);
        m.server_ops_in_wal.set(server_ops_count as f64);
        m.db_size_bytes.set(db_size_bytes as f64);
        m.pg_enabled.set(1.0);
    }

    let metrics_json = serde_json::json!({
        "golden_index_size": golden_index_size,
        "server_ops_count": server_ops_count,
        "db_size_bytes": db_size_bytes,
        "backend": "postgres"   // real Postgres or PGlite — indistinguishable to us
    });

    (axum::http::StatusCode::OK, Json(metrics_json))
}

#[derive(Serialize)]
pub struct InviteResponse {
    pub invitation_token: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

pub async fn handle_invite(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    let token = gen_token();
    let token_hash = sha256_hex(&token);
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(24);

    if let Err(e) =
        crate::db::insert_invitation(&state.pool, &tenant_id, &token_hash, expires_at).await
    {
        tracing::error!(error = %e, "failed to insert invitation");
        return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response();
    }

    (
        axum::http::StatusCode::OK,
        Json(InviteResponse {
            invitation_token: token,
            expires_at,
        }),
    )
        .into_response()
}

/// POST /api/v1/admin/invite/send — Generate invite AND send it via email.
/// Body: { "email": "user@example.com" }
pub async fn handle_invite_send(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    let email = match payload.get("email").and_then(|v| v.as_str()) {
        Some(e) if e.contains('@') => e.to_string(),
        _ => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "valid email required"})),
            )
                .into_response();
        }
    };

    if !crate::email::is_configured() {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "smtp_not_configured",
                "message": "SMTP is not configured on this server. Set SULCUS_SMTP_USERNAME and SULCUS_SMTP_PASSWORD.",
            })),
        )
            .into_response();
    }

    let tenant_id = tenant_ctx.id.clone();
    let token = gen_token();
    let token_hash = sha256_hex(&token);
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(24);

    if let Err(e) =
        crate::db::insert_invitation(&state.pool, &tenant_id, &token_hash, expires_at).await
    {
        tracing::error!(error = %e, "failed to insert invitation");
        return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response();
    }

    match crate::email::send_invite_email(&email, &token, &tenant_id).await {
        Ok(()) => {
            tracing::info!(to = %email, tenant = %tenant_id, "invite email sent");
            (
                axum::http::StatusCode::OK,
                Json(serde_json::json!({
                    "status": "sent",
                    "email": email,
                    "expires_at": expires_at.to_rfc3339(),
                    "message": format!("Invitation sent to {}", email),
                })),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(to = %email, error = %e, "failed to send invite email");
            // Invite token was created — return it so it can be shared manually
            (
                axum::http::StatusCode::OK,
                Json(serde_json::json!({
                    "status": "created_but_email_failed",
                    "email": email,
                    "invitation_token": token,
                    "expires_at": expires_at.to_rfc3339(),
                    "error": e,
                    "message": "Invite created but email delivery failed. Share the token manually.",
                })),
            )
                .into_response()
        }
    }
}

/// POST /api/v1/admin/invite/platform — Send a platform invite (new account, not org join).
/// Body: { "email": "user@example.com" }
pub async fn handle_platform_invite(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    let email = match payload.get("email").and_then(|v| v.as_str()) {
        Some(e) if e.contains('@') => e.to_string(),
        _ => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "valid email required"})),
            )
                .into_response();
        }
    };

    let token = gen_token();
    let token_hash = sha256_hex(&token);
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(24);

    // Store with invite_type = 'platform'
    if let Err(e) = sqlx::query(
        "INSERT INTO invitations (tenant_id, token_hash, expires_at, invite_type, email) VALUES ($1, $2, $3, 'platform', $4)"
    )
    .bind(&tenant_ctx.id)
    .bind(&token_hash)
    .bind(expires_at)
    .bind(&email)
    .execute(&state.pool)
    .await
    {
        tracing::error!(error = %e, "failed to insert platform invitation");
        return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response();
    }

    if !crate::email::is_configured() {
        return (
            axum::http::StatusCode::OK,
            Json(serde_json::json!({
                "status": "created",
                "invite_url": format!("https://sulcus.ca/register?invite={}", token),
                "email": email,
                "expires_at": expires_at.to_rfc3339(),
                "message": "SMTP not configured — share the link manually.",
            })),
        )
            .into_response();
    }

    match crate::email::send_platform_invite_email(&email, &token, &tenant_ctx.id).await {
        Ok(()) => {
            tracing::info!(to = %email, from_tenant = %tenant_ctx.id, "platform invite email sent");
            (
                axum::http::StatusCode::OK,
                Json(serde_json::json!({
                    "status": "sent",
                    "email": email,
                    "invite_url": format!("https://sulcus.ca/register?invite={}", token),
                    "expires_at": expires_at.to_rfc3339(),
                    "message": format!("Platform invitation sent to {}", email),
                })),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(to = %email, error = %e, "failed to send platform invite email");
            (
                axum::http::StatusCode::OK,
                Json(serde_json::json!({
                    "status": "created_but_email_failed",
                    "email": email,
                    "invite_url": format!("https://sulcus.ca/register?invite={}", token),
                    "expires_at": expires_at.to_rfc3339(),
                    "error": e,
                    "message": "Invite created but email failed. Share the link manually.",
                })),
            )
                .into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct JoinRequest {
    pub invitation_token: String,
}

#[derive(Serialize)]
pub struct JoinResponse {
    pub api_key: String,
    pub tenant_id: String,
}

pub async fn handle_join(
    State(state): State<SharedState>,
    Json(req): Json<JoinRequest>,
) -> impl IntoResponse {
    let token_hash = sha256_hex(&req.invitation_token);

    let tenant_id = match crate::db::consume_invitation(&state.pool, &token_hash).await {
        Ok(Some(tid)) => tid,
        Ok(None) => {
            return (
                axum::http::StatusCode::UNAUTHORIZED,
                "Invalid or expired token",
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "DB error during join");
            return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response();
        }
    };

    let new_key = gen_token();
    let key_hash = sha256_hex(&new_key);

    if let Err(e) = crate::db::insert_api_key(&state.pool, &tenant_id, &key_hash, "free").await {
        tracing::error!(error = %e, "failed to insert new api key");
        return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response();
    }

    (
        axum::http::StatusCode::OK,
        Json(JoinResponse {
            api_key: new_key,
            tenant_id,
        }),
    )
        .into_response()
}

pub async fn handle_usage(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    match crate::db::get_tenant_usage(&state.pool, &tenant_id).await {
        Ok(rows) => (axum::http::StatusCode::OK, Json(rows)).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch tenant usage");
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct GraphQuery {
    pub limit: Option<i64>,
    /// Pagination offset — number of nodes to skip (sorted by heat DESC).
    /// Enables progressive chunked loading. When offset > 0, edges are omitted
    /// to keep response size small; client merges chunks client-side.
    pub offset: Option<i64>,
    pub namespace: Option<String>,
    /// If true, omit labels from response (lightweight mode for graph rendering)
    pub compact: Option<bool>,
}

pub async fn handle_visualize_graph(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    axum::extract::Query(params): axum::extract::Query<GraphQuery>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    // Default to 500 nodes per page if no limit specified
    let limit = Some(params.limit.unwrap_or(500).min(2000));
    let offset = params.offset.unwrap_or(0).max(0);
    let compact = params.compact.unwrap_or(false);
    let graph_ns = crate::middleware::sanitize_ns_opt(params.namespace);
    match crate::db::get_graph_snapshot(
        &state.pool,
        &tenant_id,
        limit,
        offset,
        graph_ns.as_deref(),
        compact,
    )
    .await
    {
        Ok(snap) => (axum::http::StatusCode::OK, Json(snap)).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch graph snapshot");
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SearchRequest {
    pub query_vector: Vec<f32>,
    pub limit: Option<u32>,
    pub stable_order: Option<bool>,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub node: sulcus_core::graph::Node,
    pub score: f32,
}

/// Semantic search over the tenant's golden index using a pre-computed query vector.
pub async fn handle_search(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<SearchRequest>,
) -> impl IntoResponse {
    let limit = req.limit.unwrap_or(10) as i64;
    let eff_ns = tenant_ctx.effective_namespace();
    let tenant_id = tenant_ctx.id;
    let agent_label = tenant_ctx.agent_label.clone();
    let acl = crate::db::load_namespace_acl(&state.pool, &tenant_id, &agent_label).await;

    // Default to agent's own namespace for vector search (same as text search).
    let default_ns = if eff_ns == "default" { None } else { Some(eff_ns.as_str()) };

    // Load recall weights from tenant thermo config
    let thermo_config = crate::thermo_api::load_tenant_config(&state.pool, &tenant_id).await;

    // Determine stable ordering: per-request param overrides tenant config
    let use_stable_order = req.stable_order.unwrap_or(thermo_config.recall.stable_order);

    match crate::db::search_golden_index_ns_type_aware(&state.pool, &tenant_id, &req.query_vector, limit, default_ns, &thermo_config.recall).await {
        Ok(results) => {
            // Filter results by namespace ACL
            let out: Vec<SearchResult> = results
                .into_iter()
                .filter(|(node, _)| acl.is_allowed(&node.namespace))
                .map(|(node, score)| SearchResult { node, score })
                .collect();

            // Fire on_recall triggers + recall heat boost + resonance (fire-and-forget)
            let pool = state.pool.clone();
            let situ_classifier = state.siu_v2_classifier.clone();
            let tid = tenant_id.clone();
            let recalled: Vec<_> = out
                .iter()
                .map(|r| {
                    (
                        r.node.id.to_string(),
                        r.node.pointer_summary.clone(),
                        r.node.namespace.clone(),
                        r.node.memory_type.clone(),
                        r.node.current_heat,
                    )
                })
                .collect();
            tokio::spawn(async move {
                // Load thermo config for recall boost + resonance
                let config = crate::thermo_api::load_tenant_config(&pool, &tid).await;

                for (nid, label, ns, mt, heat) in &recalled {
                    // 0. Increment interaction epoch + stamp node
                    let _ = crate::db::increment_namespace_epoch(&pool, &tid, ns).await;
                    let _ = crate::db::stamp_node_epoch(&pool, &tid, ns, nid).await;

                    // 1. Apply recall heat boost
                    let (new_heat, _new_stability) = config.apply_recall(*heat, 1.0, mt);
                    if new_heat > *heat {
                        let _ = sqlx::query(
                            "UPDATE golden_index SET current_heat = LEAST($1, 1.0), updated_at = now() \
                             WHERE tenant_id = $2 AND id = $3::uuid AND is_pinned = false"
                        )
                        .bind(new_heat)
                        .bind(&tid)
                        .bind(nid)
                        .execute(&pool)
                        .await;
                    }

                    // 2. Fire on_recall triggers
                    let ctx = crate::trigger_engine::TriggerContext {
                        tenant_id: tid.clone(),
                        node_id: Some(nid.clone()),
                        node_label: Some(label.clone()),
                        node_namespace: Some(ns.clone()),
                        node_memory_type: Some(mt.clone()),
                        node_heat: Some(new_heat),
                        old_heat: Some(*heat),
                    };
                    let _ = crate::trigger_engine::evaluate_triggers_with_situ(
                        &pool,
                        crate::trigger_engine::TriggerEvent::OnRecall,
                        &ctx,
                        situ_classifier.as_ref(),
                    )
                    .await;
                }

                // 3. Apply resonance — spread heat to neighbors of recalled nodes
                let spread = config.resonance.spread_factor;
                let damping = config.resonance.damping;
                let gate = config.resonance.thermal_gate;
                let depth = config.resonance.depth.min(3); // cap at 3 hops server-side

                if spread > 0.0 && !recalled.is_empty() {
                    let recalled_ids: Vec<&str> = recalled.iter().map(|(id, ..)| id.as_str()).collect();
                    let _ = crate::worker::apply_resonance(&pool, &tid, &recalled_ids, spread, damping, gate, depth).await;
                }
            });

            (axum::http::StatusCode::OK, Json(out)).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "search_golden_index failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Search failed",
            )
                .into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// Text Search (SDK-friendly — no pre-computed vectors needed)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct TextSearchRequest {
    pub query: String,
    pub limit: Option<u32>,
    pub memory_type: Option<String>,
    pub namespace: Option<String>,
    /// When true, include per-result scoring breakdown (cosine similarity, heat, weights, formula).
    #[serde(default)]
    pub explain: bool,
    /// Search tier: "hot" (default, excludes archived), "cold" (archived only), "all" (both).
    /// Cold storage queries let you search archived memories without polluting active context.
    #[serde(default)]
    pub tier: Option<String>,
    /// Explicit temporal filter — start of time window (UTC ISO-8601).
    /// When provided, results within the window receive a ranking boost.
    pub time_from: Option<chrono::DateTime<chrono::Utc>>,
    /// Explicit temporal filter — end of time window (UTC ISO-8601).
    pub time_to: Option<chrono::DateTime<chrono::Utc>>,
}


/// Tokenize text into lowercase words.
fn tokenize(text: &str) -> std::collections::HashSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect()
}

/// Unified search: tries server-side semantic search first (embed query → pgvector cosine),
/// falls back to ILIKE text search if embedding fails or returns no results.
/// SDK-friendly: accepts plain text queries, server handles embedding.
pub async fn handle_text_search(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(mut req): Json<TextSearchRequest>,
) -> impl IntoResponse {
    let limit = req.limit.unwrap_or(20).min(100) as i64;
    // For RRF hybrid search, we pre-fetch a wider candidate pool from the vector index.
    // Standard RRF_CANDIDATES=10 means we retrieve 10x the requested limit, then fuse
    // with the FTS candidates and trim to `limit` after scoring. This is the key change
    // that surfaces correctly-stored-but-poorly-ranked memories (LoCoMo root cause).
    // Max 2000 to avoid excessive DB load; bounded by pgvector HNSW ef_search setting.
    let rrf_candidates_default: i64 = 10;
    let vec_candidate_limit = (limit * rrf_candidates_default).min(2000);
    let tenant_id = tenant_ctx.id.clone();
    let acl = crate::db::load_namespace_acl(&state.pool, &tenant_id, &tenant_ctx.agent_label).await;

    // Default to agent's own namespace when not specified.
    // Agents must explicitly pass a namespace to search outside their own.
    // ACL still enforced access if they do.
    // Special: namespace="*" means cross-namespace search (ACL enforced post-query).
    req.namespace = crate::middleware::sanitize_ns_opt(req.namespace);
    if req.namespace.as_deref() == Some("*") {
        req.namespace = None; // Remove filter — ACL will enforce per-result below
    } else if req.namespace.is_none() {
        let ens = tenant_ctx.effective_namespace();
        if ens != "default" {
            req.namespace = Some(ens);
        }
    }

    // --- Archive tier filter ---
    // "hot" (default) = exclude archived, "cold" = archived only, "all" = both tiers
    let archive_filter = match req.tier.as_deref() {
        Some("cold") => "AND archived_at IS NOT NULL",
        Some("all") => "",  // no filter — search everything
        _ => "AND archived_at IS NULL",  // default: hot only
    };

    // --- Phase 1: Try semantic (vector) search ---
    let semantic_rows = state.embed_query(&req.query).map(|qvec| {
        Vector::from(qvec)
    });

    let rows = if let Some(query_vec) = semantic_rows {
        // Run pgvector HNSW search with optional namespace/type filters
        // archive_filter is safe to interpolate — derived from fixed match arms, not user input
        let result = if let (Some(ref mt), Some(ref ns)) = (&req.memory_type, &req.namespace) {
            sqlx::query(&format!(
                "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                 memory_type, modality, source_mime, namespace, confidence, updated_at, \
                 (embedding <=> $2::vector) AS distance \
                 FROM golden_index \
                 WHERE tenant_id = $1 AND embedding IS NOT NULL \
                 AND memory_type = $3 AND namespace = $4 {archive_filter} \
                 ORDER BY embedding <=> $2::vector \
                 LIMIT $5",
            ))
            .bind(&tenant_id).bind(&query_vec).bind(mt).bind(ns).bind(vec_candidate_limit)
            .fetch_all(&state.pool).await
        } else if let Some(ref mt) = req.memory_type {
            sqlx::query(&format!(
                "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                 memory_type, modality, source_mime, namespace, confidence, updated_at, \
                 (embedding <=> $2::vector) AS distance \
                 FROM golden_index \
                 WHERE tenant_id = $1 AND embedding IS NOT NULL \
                 AND memory_type = $3 {archive_filter} \
                 ORDER BY embedding <=> $2::vector \
                 LIMIT $4",
            ))
            .bind(&tenant_id).bind(&query_vec).bind(mt).bind(vec_candidate_limit)
            .fetch_all(&state.pool).await
        } else if let Some(ref ns) = req.namespace {
            sqlx::query(&format!(
                "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                 memory_type, modality, source_mime, namespace, confidence, updated_at, \
                 (embedding <=> $2::vector) AS distance \
                 FROM golden_index \
                 WHERE tenant_id = $1 AND embedding IS NOT NULL \
                 AND namespace = $3 {archive_filter} \
                 ORDER BY embedding <=> $2::vector \
                 LIMIT $4",
            ))
            .bind(&tenant_id).bind(&query_vec).bind(ns).bind(vec_candidate_limit)
            .fetch_all(&state.pool).await
        } else {
            sqlx::query(&format!(
                "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                 memory_type, modality, source_mime, namespace, confidence, updated_at, \
                 (embedding <=> $2::vector) AS distance \
                 FROM golden_index \
                 WHERE tenant_id = $1 AND embedding IS NOT NULL {archive_filter} \
                 ORDER BY embedding <=> $2::vector \
                 LIMIT $3",
            ))
            .bind(&tenant_id).bind(&query_vec).bind(vec_candidate_limit)
            .fetch_all(&state.pool).await
        };

        match result {
            Ok(rows) if !rows.is_empty() => {
                tracing::debug!(count = rows.len(), "semantic search returned results");
                Ok(rows)
            }
            Ok(_) => {
                tracing::debug!("semantic search returned 0 results, falling back to text");
                Err(()) // trigger text fallback
            }
            Err(e) => {
                tracing::warn!(error = %e, "semantic search query failed, falling back to text");
                Err(())
            }
        }
    } else {
        tracing::debug!("embedder unavailable, using text search");
        Err(())
    };

    // --- Phase 2: Fall back to PostgreSQL full-text search (ts_rank + plainto_tsquery) ---
    // Handles word stemming, partial matches, and relevance ranking. Much smarter than ILIKE.
    let rows = match rows {
        Ok(rows) => Ok(rows),
        Err(()) => {
            tracing::debug!(query = %req.query, "falling back to full-text search");
            if let (Some(ref mt), Some(ref ns)) = (&req.memory_type, &req.namespace) {
                sqlx::query(&format!(
                    "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                     memory_type, modality, source_mime, namespace, confidence, updated_at, \
                     ts_rank(to_tsvector('english', COALESCE(pointer_summary, '')), plainto_tsquery('english', $2)) AS rank \
                     FROM golden_index WHERE tenant_id = $1 \
                     AND to_tsvector('english', COALESCE(pointer_summary, '')) @@ plainto_tsquery('english', $2) \
                     AND memory_type = $3 AND namespace = $4 {archive_filter} \
                     ORDER BY rank DESC, current_heat DESC LIMIT $5",
                ))
                .bind(&tenant_id).bind(&req.query).bind(mt).bind(ns).bind(limit)
                .fetch_all(&state.pool).await
            } else if let Some(ref mt) = req.memory_type {
                sqlx::query(&format!(
                    "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                     memory_type, modality, source_mime, namespace, confidence, updated_at, \
                     ts_rank(to_tsvector('english', COALESCE(pointer_summary, '')), plainto_tsquery('english', $2)) AS rank \
                     FROM golden_index WHERE tenant_id = $1 \
                     AND to_tsvector('english', COALESCE(pointer_summary, '')) @@ plainto_tsquery('english', $2) \
                     AND memory_type = $3 {archive_filter} \
                     ORDER BY rank DESC, current_heat DESC LIMIT $4",
                ))
                .bind(&tenant_id).bind(&req.query).bind(mt).bind(limit)
                .fetch_all(&state.pool).await
            } else if let Some(ref ns) = req.namespace {
                sqlx::query(&format!(
                    "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                     memory_type, modality, source_mime, namespace, confidence, updated_at, \
                     ts_rank(to_tsvector('english', COALESCE(pointer_summary, '')), plainto_tsquery('english', $2)) AS rank \
                     FROM golden_index WHERE tenant_id = $1 \
                     AND to_tsvector('english', COALESCE(pointer_summary, '')) @@ plainto_tsquery('english', $2) \
                     AND namespace = $3 {archive_filter} \
                     ORDER BY rank DESC, current_heat DESC LIMIT $4",
                ))
                .bind(&tenant_id).bind(&req.query).bind(ns).bind(limit)
                .fetch_all(&state.pool).await
            } else {
                sqlx::query(&format!(
                    "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                     memory_type, modality, source_mime, namespace, confidence, updated_at, \
                     ts_rank(to_tsvector('english', COALESCE(pointer_summary, '')), plainto_tsquery('english', $2)) AS rank \
                     FROM golden_index WHERE tenant_id = $1 \
                     AND to_tsvector('english', COALESCE(pointer_summary, '')) @@ plainto_tsquery('english', $2) \
                     {archive_filter} \
                     ORDER BY rank DESC, current_heat DESC LIMIT $3",
                ))
                .bind(&tenant_id).bind(&req.query).bind(limit)
                .fetch_all(&state.pool).await
            }
        }
    };

    match rows {
        Ok(mut rows) => {
            let thermo_config = crate::thermo_api::load_tenant_config(&state.pool, &tenant_id).await;

            // --- Phase 2b: RRF Hybrid Search or Parallel FTS merge ---
            // When use_rrf=true (default): run both vector and FTS over rrf_candidates*limit
            // candidates, then fuse ranks via Reciprocal Rank Fusion (RRF) before scoring.
            // RRF formula: score(d) = Σ 1/(k + rank(d)) for each ranked list.
            // This addresses the core LoCoMo weakness: correct memories ranked #11+ by vector
            // but #1 by keyword now surface correctly after fusion.
            //
            // When use_rrf=false: legacy behaviour — append FTS-only results that vector missed.
            let fts_weight = thermo_config.recall.fts_weight;
            let fts_min_rank = thermo_config.recall.fts_min_rank;
            let use_rrf = thermo_config.recall.use_rrf;
            let rrf_k = thermo_config.recall.rrf_k as f32;
            let rrf_candidates = thermo_config.recall.rrf_candidates as i64;

            if use_rrf && !req.query.is_empty() {
                // --- RRF path ---
                // Step 1: Fetch expanded FTS candidates (limit * rrf_candidates)
                let fts_limit = limit * rrf_candidates;
                let fts_result = if let Some(ref ns) = req.namespace {
                    sqlx::query(&format!(
                        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                         memory_type, modality, source_mime, namespace, confidence, updated_at, \
                         ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank \
                         FROM golden_index WHERE tenant_id = $1 \
                         AND search_vector @@ plainto_tsquery('english', $2) \
                         AND namespace = $3 {archive_filter} \
                         ORDER BY rank DESC LIMIT $4",
                    ))
                    .bind(&tenant_id).bind(&req.query).bind(ns).bind(fts_limit)
                    .fetch_all(&state.pool).await
                } else {
                    sqlx::query(&format!(
                        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                         memory_type, modality, source_mime, namespace, confidence, updated_at, \
                         ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank \
                         FROM golden_index WHERE tenant_id = $1 \
                         AND search_vector @@ plainto_tsquery('english', $2) \
                         {archive_filter} \
                         ORDER BY rank DESC LIMIT $3",
                    ))
                    .bind(&tenant_id).bind(&req.query).bind(fts_limit)
                    .fetch_all(&state.pool).await
                };

                match fts_result {
                    Ok(fts_rows) => {
                        // Step 2: Build rank maps for RRF.
                        // Vector list: rows already sorted by distance ASC (rank 1 = best).
                        // FTS list: fts_rows sorted by ts_rank DESC (rank 1 = best).
                        let mut rrf_scores: std::collections::HashMap<uuid::Uuid, f32> = std::collections::HashMap::new();
                        let mut rrf_fts_ranks: std::collections::HashMap<uuid::Uuid, f32> = std::collections::HashMap::new();

                        // Vector list contribution
                        for (rank_idx, row) in rows.iter().enumerate() {
                            if let Ok(id) = row.try_get::<uuid::Uuid, _>("id") {
                                let rrf = 1.0 / (rrf_k + (rank_idx + 1) as f32);
                                *rrf_scores.entry(id).or_insert(0.0) += rrf;
                            }
                        }

                        // FTS list contribution — accumulate RRF scores and track FTS-only rows
                        let existing_ids: std::collections::HashSet<uuid::Uuid> = rows
                            .iter()
                            .filter_map(|r| r.try_get::<uuid::Uuid, _>("id").ok())
                            .collect();
                        // PgRow does not implement Clone, so we cannot push fts rows into `rows`.
                        // Instead: score fts-only rows separately and merge the Value results.
                        let mut fts_only_rows: Vec<&sqlx::postgres::PgRow> = Vec::new();
                        let mut fts_added = 0usize;
                        for (rank_idx, fts_row) in fts_rows.iter().enumerate() {
                            if let Ok(id) = fts_row.try_get::<uuid::Uuid, _>("id") {
                                let rrf = 1.0 / (rrf_k + (rank_idx + 1) as f32);
                                *rrf_scores.entry(id).or_insert(0.0) += rrf;
                                let fts_rank: f32 = fts_row.try_get("rank").unwrap_or(0.0);
                                rrf_fts_ranks.insert(id, fts_rank);
                                if !existing_ids.contains(&id) {
                                    fts_only_rows.push(fts_row);
                                    fts_added += 1;
                                }
                            }
                        }

                        // Step 3: Stamp each row with its rrf_score so the scoring loop below
                        // can use it. We'll carry it through a parallel Vec since sqlx rows
                        // are immutable. Store in a lookup map keyed by UUID.
                        // (Scoring loop below reads rrf_scores by ID.)
                        if fts_added > 0 {
                            tracing::debug!(fts_added, rrf_candidates = %rows.len(), "RRF: merged FTS candidates");
                        }
                        // Attach fts_rank to the rrf_fts_ranks map for explain support below.
                        // We pass rrf_scores and rrf_fts_ranks into the scoring closure via
                        // a shared reference. Wrap in Arc to satisfy the borrow checker.
                        use std::sync::Arc;

                        // Normalize RRF scores to [0,1] before blending with heat.
                        //
                        // Root cause of LoCoMo 34.9% top_10 vs 82.9% top_200:
                        // Raw RRF values are tiny (~0.0038-0.0164 for k=60, 200 candidates).
                        // The heat component (heat * heat_weight ≈ 0.5 * 0.35 = 0.175) is
                        // ~14x larger than the RRF spread (0.0125 total), so heat noise
                        // completely dominated the ranking.
                        //
                        // After normalization: rrf_norm ∈ [0,1], heat_weight means what
                        // it says — "X% of score from heat, (1-X)% from RRF rank".
                        // The RRF spread rank 1 to 10 grows from 0.0021 to ~0.11 (sim_w=0.65),
                        // making the correct memory 5x more likely to surface in top_10.
                        let (rrf_min, rrf_max) = rrf_scores.values().fold(
                            (f32::MAX, f32::NEG_INFINITY),
                            |(mn, mx), &v| (mn.min(v), mx.max(v)),
                        );
                        let rrf_range = rrf_max - rrf_min;

                        let rrf_scores = Arc::new(rrf_scores);
                        let rrf_fts_ranks = Arc::new(rrf_fts_ranks);

                        let kw_weight = thermo_config.recall.keyword_weight;
                        let temporal_max_boost = thermo_config.recall.temporal_max_boost;
                        let temporal_decay_days = thermo_config.recall.temporal_decay_days;
                        let ns_boost = thermo_config.recall.namespace_boost;
                        let query_tokens = tokenize(&req.query);
                        let temporal_window: Option<crate::temporal::TemporalWindow> =
                            if req.time_from.is_some() || req.time_to.is_some() {
                                let start = req.time_from.unwrap_or_else(|| {
                                    chrono::NaiveDateTime::from_timestamp_opt(0, 0).unwrap().and_utc()
                                });
                                let end = req.time_to.unwrap_or_else(chrono::Utc::now);
                                Some(crate::temporal::TemporalWindow {
                                    start,
                                    end,
                                    reference: "explicit".to_string(),
                                })
                            } else {
                                crate::temporal::extract_temporal_window(&req.query, None)
                            };
                        let query_namespace = req.namespace.clone();

                        let mut scored_results: Vec<(f32, serde_json::Value)> = rows
                            .iter()
                            .filter(|r| {
                                let ns: String = r.get("namespace");
                                acl.is_allowed(&ns)
                            })
                            .map(|r| {
                                let id: uuid::Uuid = r.get("id");
                                let summary: String = r.get("pointer_summary");
                                let heat: f32 = r.get("current_heat");
                                let base_utility: f32 = r.get("base_utility");
                                let pinned: bool = r.get("is_pinned");
                                let mtype: String = r.get("memory_type");
                                let modality: String = r.get("modality");
                                let ns: String = r.get("namespace");
                                let confidence: String = r.get::<Option<String>, _>("confidence").unwrap_or_else(|| "observed".to_string());

                                let eff_heat_w = thermo_config.recall.heat_weight_for(&mtype);
                                let eff_sim_w = thermo_config.recall.similarity_weight_for(&mtype);
                                let fts_rank: f32 = rrf_fts_ranks.get(&id).copied().unwrap_or(0.0);
                                let rrf_base: f32 = rrf_scores.get(&id).copied().unwrap_or(0.0);

                                // Normalize RRF score to [0,1] over the candidate set so that
                                // heat_weight has its intended meaning: "X% of final score from heat".
                                // Without normalization, raw RRF values (~0.016) are dwarfed by
                                // heat (~0.175), making heat noise dominate ranking.
                                let rrf_norm = if rrf_range > 1e-9 {
                                    (rrf_base - rrf_min) / rrf_range
                                } else {
                                    0.5 // degenerate: single candidate
                                };

                                // Additive scoring: each signal contributes a weighted
                                // term. No multiplicative compounding — predictable,
                                // tunable, and no signal can amplify another.
                                let summary_tokens = tokenize(&summary);
                                let overlap = query_tokens.intersection(&summary_tokens).count() as f32;
                                let overlap_ratio = if query_tokens.is_empty() { 0.0 } else { overlap / query_tokens.len() as f32 };

                                let updated_at: Option<chrono::DateTime<chrono::Utc>> = r.try_get("updated_at").ok();

                                let temporal_bonus = if let Some(ref window) = temporal_window {
                                    if let Some(ua) = updated_at {
                                        if ua >= window.start && ua <= window.end { temporal_max_boost } else { 0.0 }
                                    } else { 0.0 }
                                } else { 0.0 };

                                let ns_bonus = if query_namespace.as_deref() == Some(ns.as_str()) { ns_boost } else { 0.0 };
                                let pin_bonus: f32 = if pinned { 0.15 } else { 0.0 };

                                let fused_score = (rrf_norm * eff_sim_w)
                                    + (heat * eff_heat_w)
                                    + (kw_weight * overlap_ratio)
                                    + temporal_bonus
                                    + ns_bonus
                                    + pin_bonus;

                                let mut obj = serde_json::json!({
                                    "id": id,
                                    "pointer_summary": summary,
                                    "current_heat": heat,
                                    "base_utility": base_utility,
                                    "is_pinned": pinned,
                                    "memory_type": mtype,
                                    "modality": modality,
                                    "namespace": ns,
                                    "confidence": confidence,
                                    "score": fused_score,
                                });
                                if let Some(ua) = updated_at {
                                    obj["updated_at"] = serde_json::json!(ua.to_rfc3339());
                                }
                                if req.explain {
                                    obj["explain"] = serde_json::json!({
                                        "search_method": "rrf_hybrid",
                                        "rrf_score_raw": rrf_base,
                                        "rrf_score_norm": rrf_norm,
                                        "rrf_range": rrf_range,
                                        "fts_rank": fts_rank,
                                        "heat_component": heat,
                                        "heat_weight": eff_heat_w,
                                        "sim_weight": eff_sim_w,
                                        "rrf_k": rrf_k,
                                        "keyword_overlap_ratio": overlap_ratio,
                                        "keyword_weight": kw_weight,
                                        "fused_score": fused_score,
                                    });
                                }
                                (fused_score, obj)
                            })
                            .collect();

                        // Score FTS-only rows (those not in the original vector results)
                        let fts_only_scored: Vec<(f32, serde_json::Value)> = fts_only_rows
                            .iter()
                            .filter(|r| {
                                let ns: String = r.get("namespace");
                                acl.is_allowed(&ns)
                            })
                            .map(|r| {
                                let id: uuid::Uuid = r.get("id");
                                let summary: String = r.get("pointer_summary");
                                let heat: f32 = r.get("current_heat");
                                let base_utility: f32 = r.get("base_utility");
                                let pinned: bool = r.get("is_pinned");
                                let mtype: String = r.get("memory_type");
                                let modality: String = r.get("modality");
                                let ns: String = r.get("namespace");
                                let confidence: String = r.get::<Option<String>, _>("confidence").unwrap_or_else(|| "observed".to_string());

                                let eff_heat_w = thermo_config.recall.heat_weight_for(&mtype);
                                let eff_sim_w = thermo_config.recall.similarity_weight_for(&mtype);
                                let fts_rank: f32 = rrf_fts_ranks.get(&id).copied().unwrap_or(0.0);
                                let rrf_base: f32 = rrf_scores.get(&id).copied().unwrap_or(0.0);

                                // Normalize RRF score to [0,1] (same normalization as vector rows above)
                                let rrf_norm = if rrf_range > 1e-9 {
                                    (rrf_base - rrf_min) / rrf_range
                                } else {
                                    0.5
                                };

                                // Additive scoring (FTS-only path — same formula as vector rows)
                                let summary_tokens = tokenize(&summary);
                                let overlap = query_tokens.intersection(&summary_tokens).count() as f32;
                                let overlap_ratio = if query_tokens.is_empty() { 0.0 } else { overlap / query_tokens.len() as f32 };

                                let updated_at: Option<chrono::DateTime<chrono::Utc>> = r.try_get("updated_at").ok();

                                let temporal_bonus = if let Some(ref window) = temporal_window {
                                    if let Some(ua) = updated_at {
                                        if ua >= window.start && ua <= window.end { temporal_max_boost } else { 0.0 }
                                    } else { 0.0 }
                                } else { 0.0 };

                                let ns_bonus = if query_namespace.as_deref() == Some(ns.as_str()) { ns_boost } else { 0.0 };
                                let pin_bonus: f32 = if pinned { 0.15 } else { 0.0 };

                                let fused_score = (rrf_norm * eff_sim_w)
                                    + (heat * eff_heat_w)
                                    + (kw_weight * overlap_ratio)
                                    + temporal_bonus
                                    + ns_bonus
                                    + pin_bonus;

                                let mut obj = serde_json::json!({
                                    "id": id,
                                    "pointer_summary": summary,
                                    "current_heat": heat,
                                    "base_utility": base_utility,
                                    "is_pinned": pinned,
                                    "memory_type": mtype,
                                    "modality": modality,
                                    "namespace": ns,
                                    "confidence": confidence,
                                    "score": fused_score,
                                });
                                if let Some(ua) = updated_at {
                                    obj["updated_at"] = serde_json::json!(ua.to_rfc3339());
                                }
                                if req.explain {
                                    obj["explain"] = serde_json::json!({
                                        "search_method": "rrf_hybrid_fts_only",
                                        "rrf_score_raw": rrf_base,
                                        "rrf_score_norm": rrf_norm,
                                        "rrf_range": rrf_range,
                                        "fts_rank": fts_rank,
                                        "heat_component": heat,
                                        "heat_weight": eff_heat_w,
                                        "sim_weight": eff_sim_w,
                                        "rrf_k": rrf_k,
                                        "keyword_overlap_ratio": overlap_ratio,
                                        "keyword_weight": kw_weight,
                                        "fused_score": fused_score,
                                    });
                                }
                                (fused_score, obj)
                            })
                            .collect();

                        scored_results.extend(fts_only_scored);
                        scored_results.sort_by(|(a, _), (b, _)| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
                        scored_results.truncate(limit as usize);

                        let results: Vec<serde_json::Value> = scored_results.into_iter().map(|(_, v)| v).collect();
                        return (axum::http::StatusCode::OK, axum::Json(serde_json::json!({ "results": results }))).into_response();
                    }
                    Err(e) => {
                        tracing::debug!(error = %e, "RRF FTS query failed, falling back to vector-only scoring");
                        // Fall through to legacy scoring path below
                    }
                }
            } else if fts_weight > 0.0 && !req.query.is_empty() {
                // --- Legacy path: append FTS-only results that vector missed ---
                let existing_ids: std::collections::HashSet<uuid::Uuid> = rows
                    .iter()
                    .filter_map(|r| r.try_get::<uuid::Uuid, _>("id").ok())
                    .collect();

                let fts_result = if let Some(ref ns) = req.namespace {
                    sqlx::query(&format!(
                        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                         memory_type, modality, source_mime, namespace, confidence, updated_at, \
                         ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank \
                         FROM golden_index WHERE tenant_id = $1 \
                         AND search_vector @@ plainto_tsquery('english', $2) \
                         AND namespace = $3 {archive_filter} \
                         AND ts_rank(search_vector, plainto_tsquery('english', $2)) >= $4 \
                         ORDER BY rank DESC LIMIT $5",
                    ))
                    .bind(&tenant_id).bind(&req.query).bind(ns).bind(fts_min_rank).bind(limit)
                    .fetch_all(&state.pool).await
                } else {
                    sqlx::query(&format!(
                        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                         memory_type, modality, source_mime, namespace, confidence, updated_at, \
                         ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank \
                         FROM golden_index WHERE tenant_id = $1 \
                         AND search_vector @@ plainto_tsquery('english', $2) \
                         {archive_filter} \
                         AND ts_rank(search_vector, plainto_tsquery('english', $2)) >= $3 \
                         ORDER BY rank DESC LIMIT $4",
                    ))
                    .bind(&tenant_id).bind(&req.query).bind(fts_min_rank).bind(limit)
                    .fetch_all(&state.pool).await
                };

                match fts_result {
                    Ok(fts_rows) => {
                        let mut fts_added = 0usize;
                        for fts_row in fts_rows {
                            if let Ok(id) = fts_row.try_get::<uuid::Uuid, _>("id") {
                                if !existing_ids.contains(&id) {
                                    rows.push(fts_row);
                                    fts_added += 1;
                                }
                            }
                        }
                        if fts_added > 0 {
                            tracing::debug!(fts_added, "parallel FTS merged additional results");
                        }
                    }
                    Err(e) => {
                        tracing::debug!(error = %e, "parallel FTS query failed (search_vector column may not exist yet)");
                    }
                }
            }
            // --- end Phase 2b ---

            let kw_weight = thermo_config.recall.keyword_weight;
            let temporal_max_boost = thermo_config.recall.temporal_max_boost;
            let temporal_decay_days = thermo_config.recall.temporal_decay_days;
            let ns_boost = thermo_config.recall.namespace_boost;
            let query_tokens = tokenize(&req.query);
            // Temporal window: explicit fields override, otherwise auto-detect from query
            let temporal_window: Option<crate::temporal::TemporalWindow> =
                if req.time_from.is_some() || req.time_to.is_some() {
                    let start = req.time_from.unwrap_or_else(|| {
                        chrono::NaiveDateTime::from_timestamp_opt(0, 0).unwrap().and_utc()
                    });
                    let end = req.time_to.unwrap_or_else(chrono::Utc::now);
                    Some(crate::temporal::TemporalWindow {
                        start,
                        end,
                        reference: "explicit".to_string(),
                    })
                } else {
                    crate::temporal::extract_temporal_window(&req.query, None)
                };
            let query_namespace = req.namespace.clone();

            let mut scored_results: Vec<(f32, serde_json::Value)> = rows
                .iter()
                .filter(|r| {
                    let ns: String = r.get("namespace");
                    acl.is_allowed(&ns)
                })
                .map(|r| {
                    let id: uuid::Uuid = r.get("id");
                    let summary: String = r.get("pointer_summary");
                    let heat: f32 = r.get("current_heat");
                    let base_utility: f32 = r.get("base_utility");
                    let pinned: bool = r.get("is_pinned");
                    let mtype: String = r.get("memory_type");
                    let modality: String = r.get("modality");
                    let ns: String = r.get("namespace");
                    let confidence: String = r.get::<Option<String>, _>("confidence").unwrap_or_else(|| "observed".to_string());

                    // Compute base score — multi-signal fusion with type-aware
                    // heat weighting: knowledge types score on relevance,
                    // episodic types retain stronger recency influence.
                    let cosine_sim_opt = r.try_get::<f64, _>("distance").ok().map(|d| (1.0 - d) as f32);
                    let fts_rank: f32 = r.try_get("rank").unwrap_or(0.0);
                    let eff_sim_w = thermo_config.recall.similarity_weight_for(&mtype);
                    let eff_heat_w = thermo_config.recall.heat_weight_for(&mtype);

                    let mut fused_score = if let Some(cosine_sim) = cosine_sim_opt {
                        // Vector result — base from similarity + heat (type-aware)
                        let base = (cosine_sim * eff_sim_w) + (heat * eff_heat_w);
                        // If this result also has an FTS rank (from parallel merge), boost it
                        if fts_rank > 0.0 && fts_weight > 0.0 {
                            base + (fts_rank * fts_weight)
                        } else {
                            base
                        }
                    } else {
                        // FTS-only result — use FTS rank + heat component (type-aware)
                        (fts_rank * fts_weight.max(0.5)) + (heat * eff_heat_w)
                    };

                    // Additive boosts (legacy path — same formula as RRF path)
                    let summary_tokens = tokenize(&summary);
                    let overlap = query_tokens.intersection(&summary_tokens).count() as f32;
                    let overlap_ratio = if query_tokens.is_empty() { 0.0 } else { overlap / query_tokens.len() as f32 };
                    let updated_at: Option<chrono::DateTime<chrono::Utc>> = r.try_get("updated_at").ok();

                    let temporal_bonus = if let Some(ref window) = temporal_window {
                        if let Some(ua) = updated_at {
                            if ua >= window.start && ua <= window.end { temporal_max_boost } else { 0.0 }
                        } else { 0.0 }
                    } else { 0.0 };
                    let ns_bonus = if query_namespace.as_deref() == Some(ns.as_str()) { ns_boost } else { 0.0 };

                    fused_score += kw_weight * overlap_ratio;
                    fused_score += temporal_bonus;
                    fused_score += ns_bonus;
                    let mut obj = serde_json::json!({
                        "id": id,
                        "pointer_summary": summary,
                        "current_heat": heat,
                        "base_utility": base_utility,
                        "is_pinned": pinned,
                        "memory_type": mtype,
                        "modality": modality,
                        "namespace": ns,
                        "confidence": confidence,
                        "score": fused_score,
                    });
                    if let Some(ua) = updated_at {
                        obj["updated_at"] = serde_json::json!(ua.to_rfc3339());
                    }

                    if req.explain {
                        obj["score"] = serde_json::json!(fused_score);
                        if let Some(cosine_sim) = cosine_sim_opt {
                            let base = (cosine_sim * eff_sim_w) + (heat * eff_heat_w);
                            obj["explain"] = serde_json::json!({
                                "search_method": if fts_rank > 0.0 { "vector+fts" } else { "vector" },
                                "cosine_similarity": cosine_sim,
                                "fts_rank": fts_rank,
                                "fts_weight": fts_weight,
                                "heat_component": heat,
                                "similarity_weight": eff_sim_w,
                                "heat_weight": eff_heat_w,
                                "type_aware": true,
                                "global_similarity_weight": thermo_config.recall.similarity_weight,
                                "global_heat_weight": thermo_config.recall.heat_weight,
                                "base_score": base,
                                "keyword_overlap_ratio": overlap_ratio,
                                "keyword_weight": kw_weight,
                                "fused_score": fused_score,

                            });
                        } else {
                            obj["explain"] = serde_json::json!({
                                "search_method": "fts_only",
                                "fts_rank": fts_rank,
                                "fts_weight": fts_weight,
                                "heat_component": heat,
                                "heat_weight": eff_heat_w,
                                "type_aware": true,
                                "global_heat_weight": thermo_config.recall.heat_weight,
                                "keyword_overlap_ratio": overlap_ratio,
                                "keyword_weight": kw_weight,
                                "fused_score": fused_score,
                            });
                        }
                    }

                    (fused_score, obj)
                })
                .collect();

            // Re-sort by fused score
            scored_results.sort_by(|a, b| b.0.total_cmp(&a.0));

            let results: Vec<serde_json::Value> = scored_results.into_iter().map(|(_, v)| v).collect();

            // For cold-tier searches, augment with graph entity traversal
            let mut results = results;
            if req.tier.as_deref() == Some("cold") {
                let eff_ns_cold = tenant_ctx.effective_namespace();
                let cold_ns = req.namespace.as_deref().unwrap_or(&eff_ns_cold);
                if let Ok(graph_hits) = crate::graph::graph_cold_query(
                    &state.pool, &tenant_id, cold_ns, &req.query, limit as u32,
                ).await {
                    let existing_ids: std::collections::HashSet<String> = results
                        .iter()
                        .filter_map(|r| r.get("id").and_then(|v| v.as_str()).map(String::from))
                        .collect();
                    for hit in graph_hits {
                        if !existing_ids.contains(&hit.node_id) {
                            results.push(serde_json::json!({
                                "id": hit.node_id,
                                "pointer_summary": hit.summary,
                                "current_heat": hit.archived_heat,
                                "memory_type": hit.memory_type,
                                "source": "graph_traversal",
                            }));
                        }
                    }
                }
            }

            // Apply recall boost + resonance + graph sync (fire-and-forget)
            let pool = state.pool.clone();
            let tid = tenant_id.clone();
            let recalled: Vec<(String, f32, String, String, String, bool)> = rows
                .iter()
                .filter(|r| { let ns: String = r.get("namespace"); acl.is_allowed(&ns) })
                .map(|r| {
                    let id: uuid::Uuid = r.get("id");
                    let heat: f32 = r.get("current_heat");
                    let mt: String = r.get("memory_type");
                    let ns: String = r.get("namespace");
                    let summary: String = r.get("pointer_summary");
                    let pinned: bool = r.get("is_pinned");
                    (id.to_string(), heat, mt, ns, summary, pinned)
                })
                .collect();
            tokio::spawn(async move {
                let config = crate::thermo_api::load_tenant_config(&pool, &tid).await;
                for (nid, heat, mt, ns, summary, pinned) in &recalled {
                    // Interaction epoch tracking
                    let _ = crate::db::increment_namespace_epoch(&pool, &tid, ns).await;
                    let _ = crate::db::stamp_node_epoch(&pool, &tid, ns, nid).await;

                    let (new_heat, _) = config.apply_recall(*heat, 1.0, mt);
                    if new_heat > *heat {
                        let _ = sqlx::query(
                            "UPDATE golden_index SET current_heat = LEAST($1, 1.0), updated_at = now() \
                             WHERE tenant_id = $2 AND id = $3::uuid AND is_pinned = false"
                        )
                        .bind(new_heat).bind(&tid).bind(nid).execute(&pool).await;
                    }
                    // Self-healing: ensure recalled nodes exist in AGE graph
                    if let Ok(uid) = uuid::Uuid::parse_str(nid) {
                        crate::graph::ensure_memory_vertex(
                            &pool, &tid, &uid, ns, mt, new_heat.max(*heat), summary, *pinned,
                        ).await;
                    }
                }
                // Resonance: try Cypher graph traversal first, fall back to relational BFS
                let spread = config.resonance.spread_factor;
                if spread > 0.0 && !recalled.is_empty() {
                    let ids: Vec<&str> = recalled.iter().map(|(id, ..)| id.as_str()).collect();
                    let graph_ok = crate::graph::graph_resonance(
                        &pool, &tid, &ids, spread,
                        config.resonance.damping, config.resonance.thermal_gate,
                        config.resonance.depth.min(3),
                    ).await;
                    // Fall back to relational BFS if Cypher resonance fails
                    if graph_ok.is_err() {
                        let _ = crate::worker::apply_resonance(
                            &pool, &tid, &ids, spread,
                            config.resonance.damping, config.resonance.thermal_gate,
                            config.resonance.depth.min(3),
                        ).await;
                    }
                }
            });

            let temporal_info = temporal_window.as_ref().map(|w| serde_json::json!({
                "reference": w.reference,
                "start": w.start.to_rfc3339(),
                "end": w.end.to_rfc3339(),
            }));
            (axum::http::StatusCode::OK, Json(serde_json::json!({
                "results": results,
                "provenance": {
                    "backend": "cloud",
                    "namespace": tenant_ctx.effective_namespace(),
                    "siu_classified": state.siu_available() || state.siu_v2_available(),
                    "semantic_search": state.embedder_available(),
                    "tier": req.tier.as_deref().unwrap_or("hot"),
                    "temporal_window": temporal_info,
                }
            }))).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "text search failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Search failed",
            )
                .into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// Hot Context (always-loaded memories, no query required)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct HotContextRequest {
    pub limit: Option<u32>,
    pub namespace: Option<String>,
    pub memory_type: Option<String>,
}

/// POST /api/v1/agent/hot-context
/// Returns the top N memories without requiring a search query.
/// Selection: pinned first, then highest heat, then most recently updated.
/// This is the "always loaded" context — memories an agent knows before any user query.
pub async fn handle_hot_context(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<HotContextRequest>,
) -> impl IntoResponse {
    let limit = req.limit.unwrap_or(10).min(100) as i64;
    let tenant_id = tenant_ctx.id.clone();
    let acl = crate::db::load_namespace_acl(&state.pool, &tenant_id, &tenant_ctx.agent_label).await;

    // Namespace: use request ns, fall back to agent's own, "*" means cross-namespace (ACL enforced)
    let req_ns = crate::middleware::sanitize_ns_opt(req.namespace);
    let namespace: Option<String> = if req_ns.as_deref() == Some("*") {
        None
    } else {
        req_ns.or_else(|| {
            let ens = tenant_ctx.effective_namespace();
            if ens == "default" { None } else { Some(ens) }
        })
    };

    let rows = match (&namespace, &req.memory_type) {
        (Some(ns), Some(mt)) => sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
             memory_type, modality, source_mime, namespace \
             FROM golden_index \
             WHERE tenant_id = $1 AND archived_at IS NULL \
             AND namespace = $2 AND memory_type = $3 \
             ORDER BY is_pinned DESC, current_heat DESC, updated_at DESC \
             LIMIT $4"
        ).bind(&tenant_id).bind(ns).bind(mt).bind(limit).fetch_all(&state.pool).await,
        (Some(ns), None) => sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
             memory_type, modality, source_mime, namespace \
             FROM golden_index \
             WHERE tenant_id = $1 AND archived_at IS NULL \
             AND namespace = $2 \
             ORDER BY is_pinned DESC, current_heat DESC, updated_at DESC \
             LIMIT $3"
        ).bind(&tenant_id).bind(ns).bind(limit).fetch_all(&state.pool).await,
        (None, Some(mt)) => sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
             memory_type, modality, source_mime, namespace \
             FROM golden_index \
             WHERE tenant_id = $1 AND archived_at IS NULL \
             AND memory_type = $2 \
             ORDER BY is_pinned DESC, current_heat DESC, updated_at DESC \
             LIMIT $3"
        ).bind(&tenant_id).bind(mt).bind(limit).fetch_all(&state.pool).await,
        (None, None) => sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
             memory_type, modality, source_mime, namespace \
             FROM golden_index \
             WHERE tenant_id = $1 AND archived_at IS NULL \
             ORDER BY is_pinned DESC, current_heat DESC, updated_at DESC \
             LIMIT $2"
        ).bind(&tenant_id).bind(limit).fetch_all(&state.pool).await,
    };

    match rows {
        Ok(rows) => {
            let out: Vec<SearchResult> = rows.iter()
                .filter(|r| {
                    let ns: String = r.get("namespace");
                    acl.is_allowed(&ns)
                })
                .map(|r| {
                    let id: uuid::Uuid = r.get("id");
                    let pinned: bool = r.get("is_pinned");
                    let heat: f32 = r.get("current_heat");
                    let score = if pinned { 1.0_f32 + heat } else { heat };
                    SearchResult {
                        node: sulcus_core::graph::Node {
                            id,
                            label: r.get("pointer_summary"),
                            pointer_summary: r.get("pointer_summary"),
                            base_utility: r.get("base_utility"),
                            current_heat: heat,
                            is_pinned: pinned,
                            memory_type: r.get::<Option<String>, _>("memory_type").unwrap_or_else(|| "episodic".to_string()),
                            modality: r.get::<Option<String>, _>("modality").unwrap_or_else(|| "text".to_string()),
                            source_mime: r.get("source_mime"),
                            namespace: r.get::<Option<String>, _>("namespace").unwrap_or_else(|| "default".to_string()),
                        },
                        score,
                    }
                })
                .collect();
            (axum::http::StatusCode::OK, Json(out)).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "hot_context query failed");
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "Query failed").into_response()
        }
    }
}

fn gen_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    hex::encode(bytes)
}

fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    hex::encode(hasher.finalize())
}

// ---------------------------------------------------------------------------
// Memory CRUD (paginated, filterable)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct MemoryItem {
    pub id: String,
    pub label: String,
    pub memory_type: String,
    pub heat: f64,
    pub base_utility: f64,
    pub is_pinned: bool,
    pub modality: String,
    pub namespace: String,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct PaginatedMemories {
    pub items: Vec<MemoryItem>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

// ─── User Profile API (SuperMemory parity) ────────────────────────────────────
// Pre-computed static+dynamic profile in a single call.

#[derive(Serialize)]
pub struct UserProfile {
    pub namespace: String,
    #[serde(rename = "static")]
    pub static_profile: Vec<ProfileItem>,
    pub dynamic: Vec<ProfileItem>,
    pub total_memories: i64,
    pub average_heat: f32,
}

#[derive(Serialize)]
pub struct ProfileItem {
    pub id: String,
    pub content: String,
    pub memory_type: String,
    pub heat: f32,
    pub pinned: bool,
}

#[derive(Deserialize)]
pub struct ProfileQuery {
    pub namespace: Option<String>,
    pub static_limit: Option<i64>,
    pub dynamic_limit: Option<i64>,
}

/// GET /api/v1/agent/profile
/// Returns a pre-assembled user profile with static (preferences, facts, procedural)
/// and dynamic (recent semantic, episodic) sections.
pub async fn handle_user_profile(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Query(params): Query<ProfileQuery>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id.clone();
    let namespace = params.namespace.unwrap_or_else(|| tenant_ctx.effective_namespace());
    let static_limit = params.static_limit.unwrap_or(20).min(50);
    let dynamic_limit = params.dynamic_limit.unwrap_or(10).min(30);

    // Static profile: preferences + facts + procedural (high stability, sorted by heat)
    let static_rows = sqlx::query(
        "SELECT id, pointer_summary, current_heat, is_pinned, memory_type \
         FROM golden_index \
         WHERE tenant_id = $1 AND namespace = $2 AND archived_at IS NULL \
         AND memory_type IN ('preference', 'fact', 'procedural') \
         ORDER BY is_pinned DESC, current_heat DESC \
         LIMIT $3"
    ).bind(&tenant_id).bind(&namespace).bind(static_limit)
    .fetch_all(&state.pool).await;

    // Dynamic profile: recent semantic + episodic (high recency, sorted by updated_at)
    let dynamic_rows = sqlx::query(
        "SELECT id, pointer_summary, current_heat, is_pinned, memory_type \
         FROM golden_index \
         WHERE tenant_id = $1 AND namespace = $2 AND archived_at IS NULL \
         AND memory_type IN ('semantic', 'episodic') \
         AND updated_at > NOW() - INTERVAL '7 days' \
         ORDER BY updated_at DESC, current_heat DESC \
         LIMIT $3"
    ).bind(&tenant_id).bind(&namespace).bind(dynamic_limit)
    .fetch_all(&state.pool).await;

    // Stats
    let stats = sqlx::query(
        "SELECT COUNT(*) as total, COALESCE(AVG(current_heat), 0) as avg_heat \
         FROM golden_index \
         WHERE tenant_id = $1 AND namespace = $2 AND archived_at IS NULL"
    ).bind(&tenant_id).bind(&namespace)
    .fetch_one(&state.pool).await;

    let map_rows = |rows: Vec<sqlx::postgres::PgRow>| -> Vec<ProfileItem> {
        rows.iter().map(|r| {
            ProfileItem {
                id: r.get::<uuid::Uuid, _>("id").to_string(),
                content: r.get::<String, _>("pointer_summary"),
                memory_type: r.get::<String, _>("memory_type"),
                heat: r.get::<f32, _>("current_heat"),
                pinned: r.get::<bool, _>("is_pinned"),
            }
        }).collect()
    };

    let (total, avg_heat) = match stats {
        Ok(row) => (
            row.get::<i64, _>("total"),
            row.get::<f64, _>("avg_heat") as f32,
        ),
        Err(_) => (0, 0.0),
    };

    let profile = UserProfile {
        namespace: namespace.clone(),
        static_profile: match static_rows {
            Ok(rows) => map_rows(rows),
            Err(_) => vec![],
        },
        dynamic: match dynamic_rows {
            Ok(rows) => map_rows(rows),
            Err(_) => vec![],
        },
        total_memories: total,
        average_heat: avg_heat,
    };

    (axum::http::StatusCode::OK, axum::Json(profile))
}

// ─── end User Profile API ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ListMemoriesQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub memory_type: Option<String>,
    pub namespace: Option<String>,
    pub pinned: Option<bool>,
    pub search: Option<String>,
    pub sort: Option<String>,
    pub order: Option<String>,
}

pub async fn list_memories(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Query(mut params): Query<ListMemoriesQuery>,
) -> impl IntoResponse {
    let eff_ns_list = tenant_ctx.effective_namespace();
    let acl = crate::db::load_namespace_acl(&state.pool, &tenant_ctx.id, &tenant_ctx.agent_label).await;
    let tenant_id = tenant_ctx.id;

    // Default to agent's own namespace when not specified.
    // namespace=* means cross-namespace (ACL enforced post-query).
    params.namespace = crate::middleware::sanitize_ns_opt(params.namespace);
    if params.namespace.as_deref() == Some("*") {
        params.namespace = None;
    } else if params.namespace.is_none() {
        if eff_ns_list != "default" {
            params.namespace = Some(eff_ns_list);
        }
    }
    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(25).clamp(1, 100);
    let offset = (page - 1) * page_size;

    // Build WHERE clause
    let mut conditions = vec!["tenant_id = $1".to_string(), "archived_at IS NULL".to_string()];
    #[allow(unused_assignments)]
    let mut bind_idx = 2u32;

    if params.memory_type.is_some() {
        conditions.push(format!("memory_type = ${bind_idx}"));
        bind_idx += 1;
    }
    if params.namespace.is_some() {
        conditions.push(format!("namespace = ${bind_idx}"));
        bind_idx += 1;
    }
    if params.pinned.is_some() {
        conditions.push(format!("is_pinned = ${bind_idx}"));
        bind_idx += 1;
    }
    if params.search.is_some() {
        conditions.push(format!("pointer_summary ILIKE ${bind_idx}"));
        bind_idx += 1;
    }

    let where_clause = conditions.join(" AND ");

    // Sort column (whitelist)
    let sort_col = match params.sort.as_deref() {
        Some("heat") => "current_heat",
        Some("updated_at") => "updated_at",
        Some("type") => "memory_type",
        Some("utility") => "base_utility",
        Some("label") => "pointer_summary",
        _ => "current_heat",
    };
    let sort_dir = match params.order.as_deref() {
        Some("asc") => "ASC",
        _ => "DESC",
    };

    let count_sql = format!("SELECT count(*) FROM golden_index WHERE {where_clause}");
    let data_sql = format!(
        "SELECT id::text, LEFT(pointer_summary, 128) AS pointer_summary, memory_type, current_heat, \
         COALESCE(base_utility, 0) as base_utility, COALESCE(is_pinned, false) as is_pinned, \
         COALESCE(modality, 'text') as modality, COALESCE(namespace, 'default') as namespace, \
         updated_at \
         FROM golden_index WHERE {where_clause} \
         ORDER BY {sort_col} {sort_dir} \
         LIMIT ${bind_idx} OFFSET ${next_idx}",
        bind_idx = bind_idx,
        next_idx = bind_idx + 1
    );

    // Bind dynamically — sqlx doesn't support truly dynamic bind lists easily,
    // so we build raw queries with bound parameters via query_scalar / query_as.
    // Use a macro-style approach with optional binds.

    // Count query
    let total: i64 = {
        let mut q = sqlx::query_scalar::<_, i64>(&count_sql).bind(&tenant_id);
        if let Some(ref mt) = params.memory_type {
            q = q.bind(mt);
        }
        if let Some(ref ns) = params.namespace {
            q = q.bind(ns);
        }
        if let Some(pinned) = params.pinned {
            q = q.bind(pinned);
        }
        if let Some(ref search) = params.search {
            q = q.bind(format!("%{search}%"));
        }
        q.fetch_one(&state.pool).await.unwrap_or(0)
    };

    // Data query
    let result: Result<Vec<_>, _> = {
        let mut q = sqlx::query_as::<
            _,
            (
                String,
                String,
                String,
                f32,
                f32,
                bool,
                String,
                String,
                chrono::DateTime<chrono::Utc>,
            ),
        >(&data_sql)
        .bind(&tenant_id);
        if let Some(ref mt) = params.memory_type {
            q = q.bind(mt);
        }
        if let Some(ref ns) = params.namespace {
            q = q.bind(ns);
        }
        if let Some(pinned) = params.pinned {
            q = q.bind(pinned);
        }
        if let Some(ref search) = params.search {
            q = q.bind(format!("%{search}%"));
        }
        q = q.bind(page_size).bind(offset);
        q.fetch_all(&state.pool).await
    };

    match result {
        Ok(rows) => {
            let items: Vec<MemoryItem> = rows
                .into_iter()
                .filter(|r| acl.is_allowed(&r.7)) // r.7 = namespace
                .map(|r| MemoryItem {
                    id: r.0,
                    label: r.1,
                    memory_type: r.2,
                    heat: r.3 as f64,
                    base_utility: r.4 as f64,
                    is_pinned: r.5,
                    modality: r.6,
                    namespace: r.7,
                    updated_at: r.8.to_rfc3339(),
                })
                .collect();
            (
                axum::http::StatusCode::OK,
                Json(PaginatedMemories {
                    items,
                    total,
                    page,
                    page_size,
                }),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to list memories");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Database error",
            )
                .into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// GET /api/v1/agent/nodes/:id
// ---------------------------------------------------------------------------

pub async fn get_memory(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    axum::extract::Path(node_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    let row = sqlx::query(
        "SELECT id, pointer_summary, current_heat, base_utility, memory_type, namespace, is_pinned, is_locked, modality, confidence, updated_at \
         FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid"
    )
    .bind(&tenant_id)
    .bind(&node_id)
    .fetch_optional(&state.pool)
    .await;

    match row {
        Ok(Some(r)) => {
            // Namespace ACL check
            let ns: String = r.get::<Option<String>, _>("namespace").unwrap_or_else(|| "default".to_string());
            if !crate::db::check_namespace_access(&state.pool, &tenant_id, &tenant_ctx.agent_label, &ns).await {
                return (axum::http::StatusCode::FORBIDDEN, "Access denied to this namespace").into_response();
            }
            let node = serde_json::json!({
                "id": r.get::<uuid::Uuid, _>("id"),
                "label": r.get::<Option<String>, _>("pointer_summary").unwrap_or_default(),
                "memory_type": r.get::<Option<String>, _>("memory_type").unwrap_or_else(|| "episodic".to_string()),
                "heat": r.get::<Option<f32>, _>("current_heat").unwrap_or(0.0),
                "base_utility": r.get::<Option<f32>, _>("base_utility").unwrap_or(0.0),
                "namespace": r.get::<Option<String>, _>("namespace"),
                "is_pinned": r.get::<Option<bool>, _>("is_pinned").unwrap_or(false),
                "is_locked": r.get::<Option<bool>, _>("is_locked").unwrap_or(false),
                "modality": r.get::<Option<String>, _>("modality").unwrap_or_else(|| "text".to_string()),
                "confidence": r.get::<Option<String>, _>("confidence").unwrap_or_else(|| "observed".to_string()),
                "updated_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("updated_at"),
            });
            (axum::http::StatusCode::OK, Json(node)).into_response()
        }
        Ok(None) => (axum::http::StatusCode::NOT_FOUND, "Not found").into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch node");
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response()
        }
    }
}

// PATCH /api/v1/agent/nodes/:id
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PatchMemory {
    pub label: Option<String>,
    pub memory_type: Option<String>,
    pub is_pinned: Option<bool>,
    pub is_locked: Option<bool>,
    pub namespace: Option<String>,
    pub current_heat: Option<f32>,
    pub base_utility: Option<f32>,
    /// When true with memory_type change, records a reclassify signal for SICU training.
    #[serde(default)]
    pub train_on_this: bool,
}

pub async fn patch_memory(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    axum::extract::Path(node_id): axum::extract::Path<String>,
    Json(patch): Json<PatchMemory>,
) -> impl IntoResponse {
    let agent_label = tenant_ctx.agent_label.clone();

    // Namespace ACL: check the memory's current namespace before allowing modification
    let current_ns = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(namespace, 'default') FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid"
    )
    .bind(&tenant_ctx.id)
    .bind(&node_id)
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None)
    .unwrap_or_else(|| "default".to_string());

    if !crate::db::check_namespace_access(&state.pool, &tenant_ctx.id, &agent_label, &current_ns).await {
        return (axum::http::StatusCode::FORBIDDEN, "Access denied to this namespace").into_response();
    }

    // If moving to a new namespace, check access there too
    if let Some(ref new_ns) = patch.namespace {
        if !crate::db::check_namespace_access(&state.pool, &tenant_ctx.id, &agent_label, new_ns).await {
            return (axum::http::StatusCode::FORBIDDEN, "Access denied to target namespace").into_response();
        }
    }

    let tenant_id = tenant_ctx.id;

    // If the memory is locked, only allow unlock operations (is_locked = false)
    let is_only_unlock = patch.is_locked == Some(false)
        && patch.label.is_none()
        && patch.memory_type.is_none()
        && patch.is_pinned.is_none()
        && patch.namespace.is_none()
        && patch.current_heat.is_none()
        && patch.base_utility.is_none();

    if !is_only_unlock {
        let locked: Option<bool> = sqlx::query_scalar(
            "SELECT is_locked FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid",
        )
        .bind(&tenant_id)
        .bind(&node_id)
        .fetch_optional(&state.pool)
        .await
        .unwrap_or(None);

        if locked == Some(true) {
            return (
                axum::http::StatusCode::FORBIDDEN,
                "Memory is locked and cannot be modified",
            )
                .into_response();
        }
    }

    // Build SET clause dynamically
    let mut sets = Vec::new();
    let mut bind_idx = 3u32; // $1 = tenant_id, $2 = node_id

    if patch.label.is_some() {
        sets.push(format!("pointer_summary = ${bind_idx}"));
        bind_idx += 1;
    }
    if patch.memory_type.is_some() {
        sets.push(format!("memory_type = ${bind_idx}"));
        bind_idx += 1;
    }
    if patch.is_pinned.is_some() {
        sets.push(format!("is_pinned = ${bind_idx}"));
        bind_idx += 1;
    }
    if patch.is_locked.is_some() {
        sets.push(format!("is_locked = ${bind_idx}"));
        bind_idx += 1;
    }
    if patch.namespace.is_some() {
        sets.push(format!("namespace = ${bind_idx}"));
        bind_idx += 1;
    }
    if patch.current_heat.is_some() {
        sets.push(format!("current_heat = ${bind_idx}"));
        bind_idx += 1;
    }
    if patch.base_utility.is_some() {
        sets.push(format!("base_utility = ${bind_idx}"));
        bind_idx += 1;
    }
    let _ = bind_idx; // suppress unused-assignment warning on last branch

    if sets.is_empty() {
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    }

    sets.push("updated_at = now()".to_string());

    let sql = format!(
        "UPDATE golden_index SET {} WHERE tenant_id = $1 AND id = $2::uuid",
        sets.join(", ")
    );

    let mut q = sqlx::query(&sql).bind(&tenant_id).bind(&node_id);
    if let Some(ref label) = patch.label {
        q = q.bind(label);
    }
    if let Some(ref mt) = patch.memory_type {
        q = q.bind(mt);
    }
    if let Some(pinned) = patch.is_pinned {
        q = q.bind(pinned);
    }
    if let Some(locked) = patch.is_locked {
        q = q.bind(locked);
    }
    if let Some(ref ns) = patch.namespace {
        q = q.bind(ns);
    }
    if let Some(heat) = patch.current_heat {
        q = q.bind(heat);
    }
    if let Some(util) = patch.base_utility {
        q = q.bind(util);
    }

    match q.execute(&state.pool).await {
        Ok(r) if r.rows_affected() > 0 => {
            // Return the updated node as JSON
            let fetch_result = sqlx::query_as::<
                _,
                (
                    uuid::Uuid,
                    String,
                    f32,
                    f32,
                    bool,
                    String,
                    String,
                    String,
                    chrono::DateTime<chrono::Utc>,
                ),
            >(
                "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                 memory_type, modality, namespace, updated_at \
                 FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid",
            )
            .bind(&tenant_id)
            .bind(&node_id)
            .fetch_optional(&state.pool)
            .await;
            match fetch_result {
                Ok(Some((
                    id,
                    summary,
                    heat,
                    base_utility,
                    pinned,
                    mtype,
                    modality,
                    ns,
                    updated_at,
                ))) => {
                    // Fire-and-forget: activity log + trigger evaluation
                    let pool = state.pool.clone();
                    let situ_cls = state.siu_v2_classifier.clone();
                    let tid = tenant_id.clone();
                    let sum = summary.clone();
                    let nid = id.to_string();
                    let ns2 = ns.clone();
                    let mt2 = mtype.clone();
                    let was_boosted = patch.current_heat.is_some();
                    let was_pinned = patch.is_pinned;
                    let train = patch.train_on_this;
                    let reclassified_type = patch.memory_type.clone();
                    let content_snapshot = patch.label.clone().unwrap_or_else(|| sum.clone());
                    tokio::spawn(async move {
                        // Interaction epoch tracking for patch/boost
                        let _ = crate::db::increment_namespace_epoch(&pool, &tid, &ns2).await;
                        let _ = crate::db::stamp_node_epoch(&pool, &tid, &ns2, &nid).await;

                        let _ = crate::activity::log_activity(
                            &pool,
                            &tid,
                            "api",
                            "memory.update",
                            Some(id),
                            Some(&sum),
                            None,
                        )
                        .await;

                        // train_on_this: reclassify signal for SICU
                        if train {
                            if let Some(ref new_type) = reclassified_type {
                                let _ = sqlx::query(
                                    "INSERT INTO training_signals \
                                        (memory_id, tenant_id, signal_type, \
                                         corrected_type, content_snapshot, source) \
                                     VALUES ($1::uuid, $2, 'reclassify', $3, $4, 'train_on_this')"
                                )
                                .bind(&nid)
                                .bind(&tid)
                                .bind(new_type)
                                .bind(&content_snapshot)
                                .execute(&pool)
                                .await;
                                tracing::debug!(memory_id = %nid, new_type = %new_type, "train_on_this: reclassify signal");
                            } else {
                                // No type change but train_on_this — record as accept
                                let _ = sqlx::query(
                                    "INSERT INTO training_signals \
                                        (memory_id, tenant_id, signal_type, \
                                         corrected_store, corrected_type, content_snapshot, source) \
                                     VALUES ($1::uuid, $2, 'accept', true, $3, $4, 'train_on_this')"
                                )
                                .bind(&nid)
                                .bind(&tid)
                                .bind(&mt2)
                                .bind(&content_snapshot)
                                .execute(&pool)
                                .await;
                            }
                        }

                        // Pin → strong SIVU 'store' signal (agent explicitly marked as important)
                        if was_pinned == Some(true) {
                            let _ = sqlx::query(
                                "INSERT INTO training_signals \
                                    (memory_id, tenant_id, signal_type, \
                                     corrected_store, corrected_type, content_snapshot, source) \
                                 VALUES ($1::uuid, $2, 'accept', true, $3, $4, 'pin')"
                            )
                            .bind(&nid)
                            .bind(&tid)
                            .bind(&mt2)
                            .bind(&content_snapshot)
                            .execute(&pool)
                            .await;
                            tracing::debug!(memory_id = %nid, "pin: store signal recorded (high confidence)");
                        }

                        // Manual heat boost → medium SIVU 'store' signal (agent explicitly increased heat)
                        if was_boosted {
                            let _ = sqlx::query(
                                "INSERT INTO training_signals \
                                    (memory_id, tenant_id, signal_type, \
                                     corrected_store, corrected_type, content_snapshot, source) \
                                 VALUES ($1::uuid, $2, 'accept', true, $3, $4, 'boost')"
                            )
                            .bind(&nid)
                            .bind(&tid)
                            .bind(&mt2)
                            .bind(&content_snapshot)
                            .execute(&pool)
                            .await;
                            tracing::debug!(memory_id = %nid, "boost: store signal recorded (medium confidence)");
                        }

                        // Self-healing: sync updated memory vertex to AGE graph
                        if let Ok(uid) = uuid::Uuid::parse_str(&nid) {
                            crate::graph::ensure_memory_vertex(
                                &pool, &tid, &uid, &ns2, &mt2, heat, &sum, was_pinned == Some(true),
                            ).await;
                        }

                        // Fire on_boost triggers if heat was changed
                        if was_boosted {
                            let ctx = crate::trigger_engine::TriggerContext {
                                tenant_id: tid,
                                node_id: Some(nid),
                                node_label: Some(sum),
                                node_namespace: Some(ns2),
                                node_memory_type: Some(mt2),
                                node_heat: Some(heat),
                                old_heat: None,
                            };
                            let _ = crate::trigger_engine::evaluate_triggers_with_situ(
                                &pool,
                                crate::trigger_engine::TriggerEvent::OnBoost,
                                &ctx,
                                situ_cls.as_ref(),
                            )
                            .await;
                        }
                    });

                    (
                        axum::http::StatusCode::OK,
                        Json(serde_json::json!({
                            "id": id,
                            "label": summary,
                            "pointer_summary": summary,
                            "heat": heat,
                            "current_heat": heat,
                            "base_utility": base_utility,
                            "is_pinned": pinned,
                            "memory_type": mtype,
                            "modality": modality,
                            "namespace": ns,
                            "updated_at": updated_at.to_rfc3339(),
                        })),
                    )
                        .into_response()
                }
                Ok(None) => axum::http::StatusCode::OK.into_response(),
                Err(e) => {
                    tracing::error!(error = %e, "failed to fetch patched node");
                    axum::http::StatusCode::OK.into_response()
                }
            }
        }
        Ok(_) => axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to patch memory");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Database error",
            )
                .into_response()
        }
    }
}

// ── POST /api/v1/agent/nodes — create a single memory node from the dashboard
#[derive(Deserialize)]
pub struct CreateMemory {
    pub label: String,
    pub memory_type: Option<String>,
    pub heat: Option<f32>,
    pub namespace: Option<String>,
    /// Confidence level: verified | observed | inferred | stale. Defaults to "observed".
    pub confidence: Option<String>,
    /// When true, records a training signal: "this is a valid store" (SIVU accept)
    /// and "this type is correct" (SICU accept). Teaches the SIU from manual actions.
    #[serde(default)]
    pub train_on_this: bool,
    /// Caller-supplied hints for SILU entity extraction + classification.
    /// Injected as a preamble into the SILU system prompt — guides the LLM
    /// without overriding its judgment (Phase 2: SILU prompt injection).
    #[serde(default)]
    pub extraction_hints: Option<crate::entity_extraction::ExtractionHints>,
}

pub async fn create_memory(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(body): Json<CreateMemory>,
) -> impl IntoResponse {
    // ── Input validation ────────────────────────────────
    if body.label.len() > 10_000 {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "label_too_long", "message": "Label must be 10,000 characters or fewer" })),
        ).into_response();
    }
    if body.label.trim().is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "label_empty", "message": "Label cannot be empty" })),
        ).into_response();
    }

    let agent_explicit_type = body.memory_type.is_some();
    let memory_type = body.memory_type.unwrap_or_else(|| "episodic".to_string());
    if !VALID_MEMORY_TYPES.contains(&memory_type.as_str()) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_memory_type", "message": format!("Invalid memory type '{}'. Valid: {:?}", memory_type, VALID_MEMORY_TYPES) })),
        ).into_response();
    }

    let heat = body.heat.unwrap_or(0.8).clamp(0.0, 1.0);

    // Default namespace to agent's own label (same scoping as search/list).
    // Falls back to "default" only when no agent label/namespace is set.
    let namespace = body.namespace
        .map(|ns| crate::middleware::sanitize_namespace(&ns))
        .unwrap_or_else(|| tenant_ctx.effective_namespace());
    if namespace.is_empty() || namespace.len() > 64 {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_namespace", "message": "Namespace must be 1-64 chars after sanitization" })),
        ).into_response();
    }

    const VALID_CONFIDENCE: &[&str] = &["verified", "observed", "inferred", "stale"];
    let confidence = body.confidence.as_deref().unwrap_or("observed").to_string();
    if !VALID_CONFIDENCE.contains(&confidence.as_str()) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_confidence", "message": format!("Invalid confidence '{}'. Valid: {:?}", confidence, VALID_CONFIDENCE) })),
        ).into_response();
    }

    // ── Namespace ACL: check write access ────────────────
    let agent_label = tenant_ctx.agent_label.clone();
    let target_ns = namespace.as_str();
    if !crate::db::check_namespace_access(&state.pool, &tenant_ctx.id, &agent_label, target_ns).await {
        return (
            axum::http::StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "namespace_access_denied",
                "message": format!("Agent '{}' is not allowed to write to namespace '{}'", agent_label, target_ns),
            })),
        ).into_response();
    }

    // ── Storage governance: enforce per-tenant node limit ────────────────
    let node_limit = tenant_ctx.effective_node_limit();
    let tenant_id = tenant_ctx.id;
    if node_limit > 0 {
        let count_row =
            sqlx::query_as::<_, (i64,)>("SELECT count(*) FROM golden_index WHERE tenant_id = $1")
                .bind(&tenant_id)
                .fetch_one(&state.pool)
                .await;
        if let Ok((current,)) = count_row {
            if current >= node_limit {
                return (
                    axum::http::StatusCode::TOO_MANY_REQUESTS,
                    Json(serde_json::json!({
                        "error": "storage_limit_reached",
                        "message": format!(
                            "Node limit reached ({}/{}) for plan tier '{}'. Upgrade your plan or delete old memories.",
                            current, node_limit, tenant_ctx.plan_tier
                        ),
                        "current_nodes": current,
                        "max_nodes": node_limit,
                        "plan_tier": tenant_ctx.plan_tier,
                    })),
                )
                    .into_response();
            }
        }
    }

    // ── Content dedup: reject exact duplicates within same tenant+namespace ──
    {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(body.label.trim().as_bytes());
        let content_hash = format!("{:x}", hasher.finalize());

        let exists = sqlx::query_as::<_, (i64,)>(
            "SELECT count(*) FROM golden_index \
             WHERE tenant_id = $1 AND namespace = $2 \
             AND encode(sha256(convert_to(TRIM(pointer_summary), 'UTF8')), 'hex') = $3"
        )
        .bind(&tenant_id)
        .bind(&namespace)
        .bind(&content_hash)
        .fetch_one(&state.pool)
        .await;

        if let Ok((count,)) = exists {
            if count > 0 {
                tracing::debug!(tenant = %tenant_id, namespace = %namespace, "dedup: rejecting duplicate memory");
                return (
                    axum::http::StatusCode::CONFLICT,
                    Json(serde_json::json!({
                        "error": "duplicate_memory",
                        "message": "A memory with identical content already exists in this namespace",
                    })),
                ).into_response();
            }
        }
    }

    // ── SIU classification ──
    // Prefer v2 (ONNX, text-based) over v1 (embedding-based) when available.
    // Also captures quality_confidence as base_utility.
    // Track SIU predictions for SILU training signal comparison.
    //
    // IMPORTANT: When the agent explicitly provides a memory_type, respect it.
    // SIU type prediction is only used as a fallback when no type was specified.
    // The quality gate (reject junk) still applies regardless of agent-explicit type.
    let mut base_utility: f32 = 0.0;
    let mut siu_predicted_type: Option<String> = None;
    let mut siu_predicted_store: Option<bool> = None;
    let mut siu_predicted_conf: Option<f32> = None;
    let memory_type = if let Some(v2_result) = state.classify_memory_v2(&body.label) {
        // v2 has quality gate — reject junk before storing (always applies)
        if v2_result.quality == "reject" && v2_result.quality_confidence >= 0.7 {
            tracing::info!(
                quality = %v2_result.quality,
                confidence = v2_result.quality_confidence,
                "SIU v2: rejected by quality gate"
            );
            return (axum::http::StatusCode::OK, Json(serde_json::json!({
                "id": null,
                "status": "rejected",
                "reason": "quality_gate",
                "confidence": v2_result.quality_confidence,
            }))).into_response();
        }
        // Use type_confidence as base_utility — how confident we are this memory is well-classified
        base_utility = v2_result.type_confidence.unwrap_or(v2_result.quality_confidence);
        // Capture SIU predictions for SILU training comparison
        siu_predicted_store = Some(v2_result.quality != "reject");
        siu_predicted_conf = Some(v2_result.quality_confidence);
        if let Some(ref siu_type) = v2_result.memory_type {
            siu_predicted_type = Some(siu_type.clone());
            let engine = if state.siu_v2_available() { "onnx-v2" } else { "json-v1-as-v2" };
            if agent_explicit_type {
                // Agent explicitly provided a type — keep it, log the SIU prediction for training
                tracing::debug!(
                    siu_type = %siu_type,
                    confidence = v2_result.type_confidence.unwrap_or(0.0),
                    agent_type = %memory_type,
                    base_utility,
                    engine,
                    "SIU v2: agent-explicit type preserved (SIU predicted differently)"
                );
                memory_type
            } else {
                tracing::debug!(
                    siu_type = %siu_type,
                    confidence = v2_result.type_confidence.unwrap_or(0.0),
                    default_type = %memory_type,
                    base_utility,
                    engine,
                    "SIU v2: using predicted type (no agent-explicit type)"
                );
                siu_type.clone()
            }
        } else {
            memory_type
        }
    } else if let Some(classification) = state.classify_memory(&body.label) {
        // Fall back to v1
        base_utility = classification.confidence;
        if agent_explicit_type {
            // Agent explicitly provided a type — keep it
            tracing::debug!(
                siu_type = %classification.memory_type,
                confidence = classification.confidence,
                agent_type = %memory_type,
                "SIU v1: agent-explicit type preserved"
            );
            memory_type
        } else {
            tracing::debug!(
                siu_type = %classification.memory_type,
                confidence = classification.confidence,
                default_type = %memory_type,
                "SIU v1: using predicted type (no agent-explicit type)"
            );
            classification.memory_type
        }
    } else {
        // No SIU available — default utility based on content length heuristic
        base_utility = (body.label.len() as f32 / 500.0).min(1.0).max(0.1);
        memory_type
    };

    let id = uuid::Uuid::now_v7();

    // Embed inline so new memories are immediately searchable via semantic search.
    // Falls back gracefully — memory is still stored even if embedding fails.
    let embedding = state.embed_query(&body.label);
    if embedding.is_none() {
        tracing::warn!("create_memory: inline embedding failed — memory will be stored without vector. Semantic search won't find it until backfill.");
    } else {
        tracing::debug!("create_memory: inline embedding succeeded");
    }

    let res = if let Some(ref vec) = embedding {
        sqlx::query(
            "INSERT INTO golden_index (tenant_id, id, pointer_summary, memory_type, current_heat, base_utility, namespace, modality, confidence, embedding, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'text', $8, $9::vector, now())"
        )
        .bind(&tenant_id)
        .bind(id)
        .bind(&body.label)
        .bind(&memory_type)
        .bind(heat)
        .bind(base_utility)
        .bind(&namespace)
        .bind(&confidence)
        .bind(pgvector::Vector::from(vec.clone()))
        .execute(&state.pool)
        .await
    } else {
        sqlx::query(
            "INSERT INTO golden_index (tenant_id, id, pointer_summary, memory_type, current_heat, base_utility, namespace, modality, confidence, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'text', $8, now())"
        )
        .bind(&tenant_id)
        .bind(id)
        .bind(&body.label)
        .bind(&memory_type)
        .bind(heat)
        .bind(base_utility)
        .bind(&namespace)
        .bind(&confidence)
        .execute(&state.pool)
        .await
    };

    match res {
        Ok(_) => {
            // ── AGE graph: ensure Memory vertex (self-healing, fire-and-forget) ──
            {
                let pool_g = state.pool.clone();
                let tid_g = tenant_id.clone();
                let ns_g = namespace.clone();
                let mt_g = memory_type.clone();
                let lbl_g = body.label.clone();
                let _pinned = body.heat.is_none(); // not pinned on create
                tokio::spawn(async move {
                    crate::graph::ensure_memory_vertex(
                        &pool_g, &tid_g, &id, &ns_g, &mt_g, heat, &lbl_g, false,
                    )
                    .await;
                });
            }

            // Fire-and-forget: activity log + trigger evaluation + conflict detection
            let pool = state.pool.clone();
            let situ_cls2 = state.siu_v2_classifier.clone();
            let tid = tenant_id.clone();
            let lbl = body.label.clone();
            let ns = namespace.clone();
            let mt = memory_type.clone();
            let embedding_for_conflict = embedding.clone();
            tokio::spawn(async move {
                let _ = crate::activity::log_activity(
                    &pool,
                    &tid,
                    "api",
                    "memory.create",
                    Some(id),
                    Some(&lbl),
                    None,
                )
                .await;

                // Evaluate on_store triggers
                let trigger_ctx = crate::trigger_engine::TriggerContext {
                    tenant_id: tid.clone(),
                    node_id: Some(id.to_string()),
                    node_label: Some(lbl.clone()),
                    node_namespace: Some(ns.clone()),
                    node_memory_type: Some(mt),
                    node_heat: Some(heat),
                    old_heat: None,
                };
                let _ = crate::trigger_engine::evaluate_triggers_with_situ(
                    &pool,
                    crate::trigger_engine::TriggerEvent::OnStore,
                    &trigger_ctx,
                    situ_cls2.as_ref(),
                )
                .await;

                // Conflict detection — requires an embedding
                if let Some(ref emb) = embedding_for_conflict {
                    detect_conflicts(&pool, &tid, id, &ns, &lbl, emb).await;
                }
            });

            // SILU pipeline: extract entities + classify + record training signal
            if let Some(ref extraction_cfg) = state.extraction_config {
                let pool3 = state.pool.clone();
                let pool_ovr = state.pool.clone();
                let tid3 = tenant_id.clone();
                let ns3 = namespace.clone();
                let content3 = body.label.clone();
                let cfg3 = extraction_cfg.clone();
                let mem_id3 = id;
                let siu_type3 = siu_predicted_type.clone();
                let siu_store3 = siu_predicted_store;
                let siu_conf3 = siu_predicted_conf;
                // Capture extraction hints from request body (Phase 2: SILU prompt injection)
                let hints3 = body.extraction_hints.clone();
                tokio::spawn(async move {
                    // Load per-agent SILU overrides (BYOK)
                    let overrides = sqlx::query_scalar::<_, String>(
                        "SELECT config::text FROM siu_config WHERE tenant_id = 'global' AND namespace = $1 LIMIT 1"
                    )
                    .bind(&ns3)
                    .fetch_optional(&pool_ovr)
                    .await
                    .ok()
                    .flatten()
                    .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                    .map(|c| crate::entity_extraction::SiluOverrides::from_config(&c));

                    crate::entity_extraction::extract_and_store(
                        &pool3,
                        &cfg3,
                        &tid3,
                        &ns3,
                        &mem_id3,
                        &content3,
                        siu_type3.as_deref(),
                        siu_store3,
                        siu_conf3,
                        overrides,
                        hints3,
                    )
                    .await;
                });
            }

            // train_on_this: auto-record training signals
            if body.train_on_this {
                let pool2 = state.pool.clone();
                let tid2 = tenant_id.clone();
                let mem_id = id;
                let mt2 = memory_type.clone();
                let content = body.label.clone();
                tokio::spawn(async move {
                    // SIVU signal: "this is a valid store"
                    let _ = sqlx::query(
                        "INSERT INTO training_signals \
                            (memory_id, tenant_id, signal_type, corrected_store, \
                             corrected_type, content_snapshot, source) \
                         VALUES ($1, $2, 'accept', true, $3, $4, 'train_on_this')"
                    )
                    .bind(mem_id)
                    .bind(&tid2)
                    .bind(&mt2)
                    .bind(&content)
                    .execute(&pool2)
                    .await;
                    tracing::debug!(memory_id = %mem_id, "train_on_this: accept signal recorded");
                });
            }

            (
                axum::http::StatusCode::CREATED,
                Json(serde_json::json!({
                    "id": id.to_string(),
                    "label": body.label,
                    "memory_type": memory_type,
                    "heat": heat,
                    "namespace": namespace,
                    "confidence": confidence,
                    "trained": body.train_on_this,
                    "provenance": {
                        "backend": "cloud",
                        "server": "api.sulcus.ca",
                        "storage": "postgres",
                        "sync_available": false,
                        "siu_classified": state.siu_available() || state.siu_v2_available(),
                    },
                })),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!("create_memory error: {e}");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create memory",
            )
                .into_response()
        }
    }
}

/// POST /api/v1/agent/nodes/batch — batch ingest up to 100 memory nodes in one request.
///
/// Designed for benchmark ingest and bulk import scenarios where per-node SILU latency
/// would otherwise make ingestion prohibitively slow. Key properties:
///   - Single unnest()-based bulk INSERT (1 DB round-trip for all accepted nodes)
///   - SIU quality gate applied per-item — rejects are excluded from INSERT
///   - SILU entity extraction fires as background tasks per accepted node
///   - Per-item result array: id, status (created|rejected|duplicate|error), reason
///   - Deduplication: items with identical content in same namespace are skipped
///   - Node limit governance: checked once against total remaining capacity
///
/// Returns 207 Multi-Status with per-item results.
#[derive(Deserialize)]
pub struct BatchNodeItem {
    pub label: String,
    pub memory_type: Option<String>,
    pub heat: Option<f32>,
    pub namespace: Option<String>,
    pub confidence: Option<String>,
    #[serde(default)]
    pub train_on_this: bool,
    #[serde(default)]
    pub extraction_hints: Option<crate::entity_extraction::ExtractionHints>,
}

#[derive(Deserialize)]
pub struct BatchCreateRequest {
    pub nodes: Vec<BatchNodeItem>,
}

pub async fn create_memory_batch(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(body): Json<BatchCreateRequest>,
) -> impl IntoResponse {
    const MAX_BATCH: usize = 100;

    // ── Guard: empty or oversized batch ──────────────────────────────────────
    if body.nodes.is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "empty_batch",
                "message": "nodes array must not be empty"
            })),
        ).into_response();
    }
    if body.nodes.len() > MAX_BATCH {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "batch_too_large",
                "message": format!("Batch size {} exceeds maximum of {}", body.nodes.len(), MAX_BATCH)
            })),
        ).into_response();
    }

    let tenant_id = tenant_ctx.id.clone();
    let agent_label = tenant_ctx.agent_label.clone();

    // ── Storage governance: check remaining capacity once for whole batch ────
    let node_limit = tenant_ctx.effective_node_limit();
    let mut remaining_capacity: Option<i64> = None;
    if node_limit > 0 {
        if let Ok((current,)) = sqlx::query_as::<_, (i64,)>(
            "SELECT count(*) FROM golden_index WHERE tenant_id = $1"
        )
        .bind(&tenant_id)
        .fetch_one(&state.pool)
        .await
        {
            let rem = node_limit - current;
            if rem <= 0 {
                return (
                    axum::http::StatusCode::TOO_MANY_REQUESTS,
                    Json(serde_json::json!({
                        "error": "storage_limit_reached",
                        "message": format!(
                            "Node limit reached ({}/{}) for plan tier '{}'. Upgrade or delete old memories.",
                            current, node_limit, tenant_ctx.plan_tier
                        ),
                        "current_nodes": current,
                        "max_nodes": node_limit,
                    })),
                ).into_response();
            }
            remaining_capacity = Some(rem);
        }
    }

    // ── Per-item validation + SIU gate ───────────────────────────────────────
    const VALID_MEMORY_TYPES_BATCH: &[&str] = &["episodic", "semantic", "procedural", "preference", "fact", "moment"];
    const VALID_CONFIDENCE_BATCH: &[&str] = &["verified", "observed", "inferred", "stale"];

    struct AcceptedNode {
        id: uuid::Uuid,
        label: String,
        memory_type: String,
        heat: f32,
        namespace: String,
        confidence: String,
        base_utility: f32,
        embedding: Option<Vec<f32>>,
        train_on_this: bool,
        extraction_hints: Option<crate::entity_extraction::ExtractionHints>,
        item_index: usize,
    }

    let mut results: Vec<serde_json::Value> = Vec::with_capacity(body.nodes.len());
    let mut accepted: Vec<AcceptedNode> = Vec::new();

    // Pre-compute content hashes for batch dedup check
    use sha2::{Sha256, Digest};

    for (idx, item) in body.nodes.into_iter().enumerate() {
        // Label validation
        if item.label.trim().is_empty() {
            results.push(serde_json::json!({ "index": idx, "status": "rejected", "reason": "label_empty" }));
            continue;
        }
        if item.label.len() > 10_000 {
            results.push(serde_json::json!({ "index": idx, "status": "rejected", "reason": "label_too_long" }));
            continue;
        }

        // Memory type
        let agent_explicit_type = item.memory_type.is_some();
        let base_memory_type = item.memory_type.clone().unwrap_or_else(|| "episodic".to_string());
        if !VALID_MEMORY_TYPES_BATCH.contains(&base_memory_type.as_str()) {
            results.push(serde_json::json!({ "index": idx, "status": "rejected", "reason": "invalid_memory_type", "type": base_memory_type }));
            continue;
        }

        // Namespace
        let namespace = item.namespace
            .map(|ns| crate::middleware::sanitize_namespace(&ns))
            .unwrap_or_else(|| tenant_ctx.effective_namespace());
        if namespace.is_empty() || namespace.len() > 64 {
            results.push(serde_json::json!({ "index": idx, "status": "rejected", "reason": "invalid_namespace" }));
            continue;
        }

        // Namespace ACL
        if !crate::db::check_namespace_access(&state.pool, &tenant_id, &agent_label, &namespace).await {
            results.push(serde_json::json!({ "index": idx, "status": "rejected", "reason": "namespace_access_denied", "namespace": namespace }));
            continue;
        }

        // Confidence
        let confidence = item.confidence.as_deref().unwrap_or("observed").to_string();
        if !VALID_CONFIDENCE_BATCH.contains(&confidence.as_str()) {
            results.push(serde_json::json!({ "index": idx, "status": "rejected", "reason": "invalid_confidence" }));
            continue;
        }

        let heat = item.heat.unwrap_or(0.8).clamp(0.0, 1.0);

        // Content dedup check
        let mut hasher = Sha256::new();
        hasher.update(item.label.trim().as_bytes());
        let content_hash = format!("{:x}", hasher.finalize());

        let is_dup = sqlx::query_as::<_, (i64,)>(
            "SELECT count(*) FROM golden_index \
             WHERE tenant_id = $1 AND namespace = $2 \
             AND encode(sha256(convert_to(TRIM(pointer_summary), 'UTF8')), 'hex') = $3"
        )
        .bind(&tenant_id)
        .bind(&namespace)
        .bind(&content_hash)
        .fetch_one(&state.pool)
        .await
        .map(|(c,)| c > 0)
        .unwrap_or(false);

        if is_dup {
            results.push(serde_json::json!({ "index": idx, "status": "duplicate", "reason": "content_already_exists" }));
            continue;
        }

        // SIU classification + quality gate
        let mut base_utility: f32 = (item.label.len() as f32 / 500.0).min(1.0).max(0.1);
        let mut siu_predicted_type: Option<String> = None;
        let mut siu_predicted_store: Option<bool> = None;
        let mut siu_predicted_conf: Option<f32> = None;

        let memory_type = if let Some(v2_result) = state.classify_memory_v2(&item.label) {
            if v2_result.quality == "reject" && v2_result.quality_confidence >= 0.7 {
                results.push(serde_json::json!({ "index": idx, "status": "rejected", "reason": "quality_gate", "confidence": v2_result.quality_confidence }));
                continue;
            }
            base_utility = v2_result.type_confidence.unwrap_or(v2_result.quality_confidence);
            siu_predicted_store = Some(v2_result.quality != "reject");
            siu_predicted_conf = Some(v2_result.quality_confidence);
            if let Some(ref siu_type) = v2_result.memory_type {
                siu_predicted_type = Some(siu_type.clone());
                if agent_explicit_type { base_memory_type } else { siu_type.clone() }
            } else {
                base_memory_type
            }
        } else if let Some(cls) = state.classify_memory(&item.label) {
            base_utility = cls.confidence;
            siu_predicted_store = Some(true);
            siu_predicted_conf = Some(cls.confidence);
            if agent_explicit_type { base_memory_type } else { cls.memory_type }
        } else {
            base_memory_type
        };

        // Inline embedding
        let embedding = state.embed_query(&item.label);

        let id = uuid::Uuid::now_v7();
        accepted.push(AcceptedNode {
            id,
            label: item.label,
            memory_type,
            heat,
            namespace,
            confidence,
            base_utility,
            embedding,
            train_on_this: item.train_on_this,
            extraction_hints: item.extraction_hints,
            item_index: idx,
        });

        // Drop predicted fields — needed for spawn below, track via accepted vec
        let _ = (siu_predicted_type, siu_predicted_store, siu_predicted_conf);
    }

    // ── Capacity cap: trim if batch would exceed remaining quota ─────────────
    if let Some(cap) = remaining_capacity {
        let over = accepted.len() as i64 - cap;
        if over > 0 {
            let trim_at = cap as usize;
            for node in accepted.drain(trim_at..) {
                results.push(serde_json::json!({ "index": node.item_index, "status": "rejected", "reason": "storage_limit_reached" }));
            }
        }
    }

    if accepted.is_empty() {
        return (
            axum::http::StatusCode::MULTI_STATUS,
            Json(serde_json::json!({
                "created": 0,
                "rejected": results.len(),
                "results": results,
            })),
        ).into_response();
    }

    // ── Bulk INSERT (unnest) — 1 round-trip for all accepted nodes ───────────
    // Build parallel arrays for unnest
    let mut ids: Vec<uuid::Uuid> = Vec::with_capacity(accepted.len());
    let mut labels: Vec<String> = Vec::with_capacity(accepted.len());
    let mut types: Vec<String> = Vec::with_capacity(accepted.len());
    let mut heats: Vec<f32> = Vec::with_capacity(accepted.len());
    let mut utilities: Vec<f32> = Vec::with_capacity(accepted.len());
    let mut namespaces: Vec<String> = Vec::with_capacity(accepted.len());
    let mut confidences: Vec<String> = Vec::with_capacity(accepted.len());

    for node in &accepted {
        ids.push(node.id);
        labels.push(node.label.clone());
        types.push(node.memory_type.clone());
        heats.push(node.heat);
        utilities.push(node.base_utility);
        namespaces.push(node.namespace.clone());
        confidences.push(node.confidence.clone());
    }

    // Split into nodes with embeddings and without
    let mut ids_with_emb: Vec<uuid::Uuid> = Vec::new();
    let mut emb_labels: Vec<String> = Vec::new();
    let mut emb_types: Vec<String> = Vec::new();
    let mut emb_heats: Vec<f32> = Vec::new();
    let mut emb_utilities: Vec<f32> = Vec::new();
    let mut emb_namespaces: Vec<String> = Vec::new();
    let mut emb_confidences: Vec<String> = Vec::new();
    let mut emb_vectors: Vec<pgvector::Vector> = Vec::new();

    let mut ids_no_emb: Vec<uuid::Uuid> = Vec::new();
    let mut no_emb_labels: Vec<String> = Vec::new();
    let mut no_emb_types: Vec<String> = Vec::new();
    let mut no_emb_heats: Vec<f32> = Vec::new();
    let mut no_emb_utilities: Vec<f32> = Vec::new();
    let mut no_emb_namespaces: Vec<String> = Vec::new();
    let mut no_emb_confidences: Vec<String> = Vec::new();

    for node in &accepted {
        if let Some(ref vec) = node.embedding {
            ids_with_emb.push(node.id);
            emb_labels.push(node.label.clone());
            emb_types.push(node.memory_type.clone());
            emb_heats.push(node.heat);
            emb_utilities.push(node.base_utility);
            emb_namespaces.push(node.namespace.clone());
            emb_confidences.push(node.confidence.clone());
            emb_vectors.push(pgvector::Vector::from(vec.clone()));
        } else {
            ids_no_emb.push(node.id);
            no_emb_labels.push(node.label.clone());
            no_emb_types.push(node.memory_type.clone());
            no_emb_heats.push(node.heat);
            no_emb_utilities.push(node.base_utility);
            no_emb_namespaces.push(node.namespace.clone());
            no_emb_confidences.push(node.confidence.clone());
        }
    }

    // Insert nodes with embeddings
    if !ids_with_emb.is_empty() {
        let res = sqlx::query(
            "INSERT INTO golden_index \
             (tenant_id, id, pointer_summary, memory_type, current_heat, base_utility, namespace, modality, confidence, embedding, updated_at) \
             SELECT $1, u.id, u.label, u.mt, u.heat, u.utility, u.ns, 'text', u.conf, u.emb::vector, now() \
             FROM unnest($2::uuid[], $3::text[], $4::text[], $5::float4[], $6::float4[], $7::text[], $8::text[], $9::vector[]) \
             AS u(id, label, mt, heat, utility, ns, conf, emb)"
        )
        .bind(&tenant_id)
        .bind(&ids_with_emb)
        .bind(&emb_labels)
        .bind(&emb_types)
        .bind(&emb_heats)
        .bind(&emb_utilities)
        .bind(&emb_namespaces)
        .bind(&emb_confidences)
        .bind(&emb_vectors)
        .execute(&state.pool)
        .await;
        if let Err(e) = res {
            tracing::error!(error = %e, "batch create: bulk INSERT with embeddings failed");
        }
    }

    // Insert nodes without embeddings
    if !ids_no_emb.is_empty() {
        let res = sqlx::query(
            "INSERT INTO golden_index \
             (tenant_id, id, pointer_summary, memory_type, current_heat, base_utility, namespace, modality, confidence, updated_at) \
             SELECT $1, u.id, u.label, u.mt, u.heat, u.utility, u.ns, 'text', u.conf, now() \
             FROM unnest($2::uuid[], $3::text[], $4::text[], $5::float4[], $6::float4[], $7::text[], $8::text[]) \
             AS u(id, label, mt, heat, utility, ns, conf)"
        )
        .bind(&tenant_id)
        .bind(&ids_no_emb)
        .bind(&no_emb_labels)
        .bind(&no_emb_types)
        .bind(&no_emb_heats)
        .bind(&no_emb_utilities)
        .bind(&no_emb_namespaces)
        .bind(&no_emb_confidences)
        .execute(&state.pool)
        .await;
        if let Err(e) = res {
            tracing::error!(error = %e, "batch create: bulk INSERT without embeddings failed");
        }
    }

    // ── Fire background tasks per accepted node ──────────────────────────────
    for node in &accepted {
        let id = node.id;
        let pool_g = state.pool.clone();
        let tid_g = tenant_id.clone();
        let ns_g = node.namespace.clone();
        let mt_g = node.memory_type.clone();
        let lbl_g = node.label.clone();
        let heat_g = node.heat;

        // AGE graph vertex
        tokio::spawn(async move {
            crate::graph::ensure_memory_vertex(
                &pool_g, &tid_g, &id, &ns_g, &mt_g, heat_g, &lbl_g, false,
            ).await;
        });

        // Activity log + trigger evaluation
        let pool2 = state.pool.clone();
        let tid2 = tenant_id.clone();
        let ns2 = node.namespace.clone();
        let mt2 = node.memory_type.clone();
        let lbl2 = node.label.clone();
        let situ2 = state.siu_v2_classifier.clone();
        tokio::spawn(async move {
            let _ = crate::activity::log_activity(&pool2, &tid2, "api", "memory.create", Some(id), Some(&lbl2), None).await;
            let trigger_ctx = crate::trigger_engine::TriggerContext {
                tenant_id: tid2.clone(),
                node_id: Some(id.to_string()),
                node_label: Some(lbl2.clone()),
                node_namespace: Some(ns2.clone()),
                node_memory_type: Some(mt2),
                node_heat: Some(heat_g),
                old_heat: None,
            };
            let _ = crate::trigger_engine::evaluate_triggers_with_situ(
                &pool2,
                crate::trigger_engine::TriggerEvent::OnStore,
                &trigger_ctx,
                situ2.as_ref(),
            ).await;
        });

        // SILU entity extraction
        if let Some(ref extraction_cfg) = state.extraction_config {
            let pool3 = state.pool.clone();
            let tid3 = tenant_id.clone();
            let ns3 = node.namespace.clone();
            let lbl3 = node.label.clone();
            let cfg3 = extraction_cfg.clone();
            let hints3 = node.extraction_hints.clone();
            let mt3 = node.memory_type.clone();
            tokio::spawn(async move {
                let overrides = sqlx::query_scalar::<_, String>(
                    "SELECT config::text FROM siu_config WHERE tenant_id = 'global' AND namespace = $1 LIMIT 1"
                )
                .bind(&ns3)
                .fetch_optional(&pool3)
                .await
                .ok()
                .flatten()
                .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                .map(|c| crate::entity_extraction::SiluOverrides::from_config(&c));

                crate::entity_extraction::extract_and_store(
                    &pool3, &cfg3, &tid3, &ns3, &id, &lbl3,
                    Some(&mt3), None, None, overrides, hints3,
                ).await;
            });
        }

        // train_on_this signal
        if node.train_on_this {
            let pool4 = state.pool.clone();
            let tid4 = tenant_id.clone();
            let mt4 = node.memory_type.clone();
            let lbl4 = node.label.clone();
            tokio::spawn(async move {
                let _ = sqlx::query(
                    "INSERT INTO training_signals \
                     (memory_id, tenant_id, signal_type, corrected_store, corrected_type, content_snapshot, source) \
                     VALUES ($1, $2, 'accept', true, $3, $4, 'train_on_this')"
                )
                .bind(id)
                .bind(&tid4)
                .bind(&mt4)
                .bind(&lbl4)
                .execute(&pool4)
                .await;
            });
        }

        // Activity log result to Discord results array
        results.push(serde_json::json!({
            "index": node.item_index,
            "id": node.id.to_string(),
            "status": "created",
            "label": node.label,
            "memory_type": node.memory_type,
            "heat": node.heat,
            "namespace": node.namespace,
        }));
    }

    let created = accepted.len();
    let rejected = results.iter().filter(|r| r["status"] != "created").count();

    // Sort results by index for deterministic output
    results.sort_by_key(|r| r["index"].as_u64().unwrap_or(0));

    (
        axum::http::StatusCode::MULTI_STATUS,
        Json(serde_json::json!({
            "created": created,
            "rejected": rejected,
            "total": created + rejected,
            "results": results,
        })),
    ).into_response()
}

/// POST /api/v1/agent/backfill-embeddings
/// Triggers embedding backfill for all memories in the tenant that lack embeddings.
pub async fn handle_backfill_embeddings(
    State(state): State<crate::SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id.clone();
    tracing::info!(tenant = %tenant_id, "triggering embedding backfill");

    match crate::db::backfill_missing_embeddings(&state.pool, &state, Some(&tenant_id)).await {
        Ok(count) => {
            tracing::info!(tenant = %tenant_id, count, "embedding backfill complete");
            Json(serde_json::json!({
                "status": "complete",
                "backfilled": count,
                "tenant_id": tenant_id,
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "embedding backfill failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "backfill_failed",
                    "message": format!("{e}"),
                })),
            )
                .into_response()
        }
    }
}

/// POST /api/v1/agent/backfill-utility
///
/// Re-scores all memories with base_utility == 0 through SIU.
/// Processes in batches of 100 to avoid memory pressure.
/// Returns the number of memories re-scored.
pub async fn handle_backfill_utility(
    State(state): State<crate::SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id.clone();
    let agent_label = tenant_ctx.agent_label.clone();
    let namespace = tenant_ctx.effective_namespace();

    tracing::info!(tenant = %tenant_id, namespace = %namespace, "starting base_utility backfill via SIU");

    // Find all memories with base_utility = 0 (or NULL) in this namespace
    let rows: Vec<(String, String, String)> = match sqlx::query_as(
        "SELECT id::text, pointer_summary, COALESCE(memory_type, 'episodic') \
         FROM golden_index \
         WHERE tenant_id = $1 AND namespace = $2 \
           AND (base_utility IS NULL OR base_utility = 0) \
         ORDER BY updated_at DESC \
         LIMIT 5000"
    )
    .bind(&tenant_id)
    .bind(&namespace)
    .fetch_all(&state.pool)
    .await {
        Ok(r) => r,
        Err(e) => {
            return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                "error": "query_failed",
                "message": format!("{e}"),
            }))).into_response();
        }
    };

    let total_candidates = rows.len();
    if total_candidates == 0 {
        return Json(serde_json::json!({
            "status": "complete",
            "backfilled": 0,
            "namespace": namespace,
            "message": "No memories with base_utility=0 found",
        })).into_response();
    }

    let mut scored = 0u32;
    let mut skipped = 0u32;
    let mut rejected = 0u32;

    for (id, summary, _mem_type) in &rows {
        // Try SIU v2 first, fall back to v1
        // NOTE: Do NOT reject during backfill — these memories already exist.
        // The quality gate is for new stores only. For backfill, we use the
        // confidence score as utility even if quality=reject.
        let utility = if let Some(v2) = state.classify_memory_v2(summary) {
            if v2.quality == "reject" {
                rejected += 1;
                // Use a low but non-zero utility — memory exists, it's just low quality
                v2.type_confidence.unwrap_or(0.1).max(0.05)
            } else {
                v2.type_confidence.unwrap_or(v2.quality_confidence)
            }
        } else if let Some(v1) = state.classify_memory(summary) {
            v1.confidence
        } else {
            // No SIU available — use length heuristic
            (summary.len() as f32 / 500.0).min(1.0).max(0.1)
        };

        match sqlx::query(
            "UPDATE golden_index SET base_utility = $1, updated_at = NOW() \
             WHERE tenant_id = $2 AND id = $3::uuid"
        )
        .bind(utility)
        .bind(&tenant_id)
        .bind(id)
        .execute(&state.pool)
        .await {
            Ok(r) if r.rows_affected() > 0 => scored += 1,
            Ok(_) => skipped += 1,
            Err(e) => {
                tracing::warn!(id = %id, error = %e, "backfill-utility: update failed");
                skipped += 1;
            }
        }
    }

    // Log activity
    let pool = state.pool.clone();
    let tid = tenant_id.clone();
    let ns = namespace.clone();
    tokio::spawn(async move {
        let _ = crate::activity::log_activity(
            &pool, &tid, "api", "backfill-utility",
            None, Some(&format!("Re-scored {scored}/{total_candidates} memories in {ns} (rejected={rejected}, skipped={skipped})")), None,
        ).await;
    });

    tracing::info!(
        tenant = %tenant_id,
        namespace = %namespace,
        scored,
        rejected,
        skipped,
        total = total_candidates,
        "base_utility backfill complete"
    );

    Json(serde_json::json!({
        "status": "complete",
        "backfilled": scored,
        "rejected": rejected,
        "skipped": skipped,
        "total_candidates": total_candidates,
        "namespace": namespace,
    })).into_response()
}

#[derive(serde::Deserialize, Default)]
pub struct DeleteMemoryParams {
    /// When true, records a reject signal for SIVU training before deleting.
    #[serde(default)]
    pub train: Option<bool>,
}

pub async fn delete_memory(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    axum::extract::Path(node_id): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<DeleteMemoryParams>,
) -> impl IntoResponse {
    let train_on_this = params.train.unwrap_or(false);

    // If train_on_this, snapshot the content before deleting
    if train_on_this {
        let snapshot: Option<(String, String)> = sqlx::query_as(
            "SELECT pointer_summary, COALESCE(memory_type, 'episodic') \
             FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid"
        )
        .bind(&tenant_ctx.id)
        .bind(&node_id)
        .fetch_optional(&state.pool)
        .await
        .unwrap_or(None);

        if let Some((content, mem_type)) = snapshot {
            let pool = state.pool.clone();
            let tid = tenant_ctx.id.clone();
            let nid = node_id.clone();
            tokio::spawn(async move {
                let _ = sqlx::query(
                    "INSERT INTO training_signals \
                        (memory_id, tenant_id, signal_type, \
                         corrected_store, predicted_type, content_snapshot, source) \
                     VALUES ($1::uuid, $2, 'reject', false, $3, $4, 'train_on_this')"
                )
                .bind(&nid)
                .bind(&tid)
                .bind(&mem_type)
                .bind(&content)
                .execute(&pool)
                .await;
                tracing::debug!(memory_id = %nid, "train_on_this: reject signal recorded on delete");
            });
        }
    }

    // Namespace ACL: check before delete
    let ns = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(namespace, 'default') FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid"
    )
    .bind(&tenant_ctx.id)
    .bind(&node_id)
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None)
    .unwrap_or_else(|| "default".to_string());

    if !crate::db::check_namespace_access(&state.pool, &tenant_ctx.id, &tenant_ctx.agent_label, &ns).await {
        return (axum::http::StatusCode::FORBIDDEN, "Access denied to this namespace").into_response();
    }

    let tenant_id = tenant_ctx.id;

    // Check if memory is locked — locked memories cannot be deleted via API
    let locked: Option<bool> = sqlx::query_scalar(
        "SELECT is_locked FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&tenant_id)
    .bind(&node_id)
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None);

    if locked == Some(true) {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "Memory is locked and cannot be deleted",
        )
            .into_response();
    }

    let res = sqlx::query(
        "DELETE FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid AND is_locked = FALSE",
    )
    .bind(&tenant_id)
    .bind(&node_id)
    .execute(&state.pool)
    .await;

    match res {
        Ok(r) if r.rows_affected() > 0 => {
            let pool = state.pool.clone();
            let tid = tenant_id.clone();
            let nid = node_id.clone();
            tokio::spawn(async move {
                let _ = crate::activity::log_activity(
                    &pool,
                    &tid,
                    "api",
                    "memory.delete",
                    uuid::Uuid::parse_str(&nid).ok(),
                    None,
                    None,
                )
                .await;
            });
            axum::http::StatusCode::NO_CONTENT.into_response()
        }
        Ok(_) => axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to delete memory");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Database error",
            )
                .into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// Bulk delete
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct BulkDeleteRequest {
    /// Explicit list of node IDs to delete.
    pub ids: Option<Vec<String>>,
    /// Or delete by filter: memory_type + namespace combo.
    pub memory_type: Option<String>,
    pub namespace: Option<String>,
    /// If true, delete ALL memories for this tenant (ignores other filters).
    pub delete_all: Option<bool>,
}

#[derive(Serialize)]
pub struct BulkDeleteResponse {
    pub deleted: u64,
}

pub async fn bulk_delete_memories(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(mut req): Json<BulkDeleteRequest>,
) -> impl IntoResponse {
    req.namespace = crate::middleware::sanitize_ns_opt(req.namespace);
    let acl = crate::db::load_namespace_acl(&state.pool, &tenant_ctx.id, &tenant_ctx.agent_label).await;
    let tenant_id = tenant_ctx.id;

    // Delete ALL memories for this tenant (danger zone)
    // Only allowed if agent has no ACL identity (dashboard) or default is allow with no deny rules
    if req.delete_all == Some(true) {
        if acl.has_identity {
            return (
                axum::http::StatusCode::FORBIDDEN,
                Json(BulkDeleteResponse { deleted: 0 }),
            ).into_response();
        }
        match sqlx::query("DELETE FROM golden_index WHERE tenant_id = $1")
            .bind(&tenant_id)
            .execute(&state.pool)
            .await
        {
            Ok(r) => {
                let pool = state.pool.clone();
                let tid = tenant_id.clone();
                tokio::spawn(async move {
                    let _ = crate::activity::log_activity(
                        &pool,
                        &tid,
                        "api",
                        "memory.delete_all",
                        None,
                        None,
                        None,
                    )
                    .await;
                });
                return (
                    axum::http::StatusCode::OK,
                    Json(BulkDeleteResponse {
                        deleted: r.rows_affected(),
                    }),
                )
                    .into_response();
            }
            Err(e) => {
                tracing::error!("bulk delete all failed: {e}");
                return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
    }

    if let Some(ids) = &req.ids {
        if ids.is_empty() {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(BulkDeleteResponse { deleted: 0 }),
            )
                .into_response();
        }
        // Delete by explicit ID list (batches of 100)
        let mut total_deleted = 0u64;
        for chunk in ids.chunks(100) {
            let placeholders: Vec<String> = chunk
                .iter()
                .enumerate()
                .map(|(i, _)| format!("${}::uuid", i + 2))
                .collect();
            let sql = format!(
                "DELETE FROM golden_index WHERE tenant_id = $1 AND id IN ({})",
                placeholders.join(", ")
            );
            let mut q = sqlx::query(&sql).bind(&tenant_id);
            for id in chunk {
                q = q.bind(id);
            }
            if let Ok(r) = q.execute(&state.pool).await {
                total_deleted += r.rows_affected();
            }
        }
        return (
            axum::http::StatusCode::OK,
            Json(BulkDeleteResponse {
                deleted: total_deleted,
            }),
        )
            .into_response();
    }

    // Filter-based delete
    let mut conditions = vec!["tenant_id = $1".to_string()];
    let mut bind_idx = 2u32;

    if req.memory_type.is_some() {
        conditions.push(format!("memory_type = ${bind_idx}"));
        bind_idx += 1;
    }
    if req.namespace.is_some() {
        // ACL check: if deleting by namespace, verify agent is allowed
        if let Some(ref ns) = req.namespace {
            if !acl.is_allowed(ns) {
                return (axum::http::StatusCode::FORBIDDEN, "Access denied to this namespace").into_response();
            }
        }
        conditions.push(format!("namespace = ${bind_idx}"));
        bind_idx += 1;
    } else if acl.has_identity {
        // Agent with ACL identity trying filter-delete without specifying namespace — deny
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(BulkDeleteResponse { deleted: 0 }),
        ).into_response();
    }
    let _ = bind_idx; // suppress unused-assignment warning on last branch

    // Safety: require at least one filter beyond tenant_id
    if conditions.len() < 2 {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(BulkDeleteResponse { deleted: 0 }),
        )
            .into_response();
    }

    let sql = format!(
        "DELETE FROM golden_index WHERE {}",
        conditions.join(" AND ")
    );
    let mut q = sqlx::query(&sql).bind(&tenant_id);
    if let Some(ref mt) = req.memory_type {
        q = q.bind(mt);
    }
    if let Some(ref ns) = req.namespace {
        q = q.bind(ns);
    }

    match q.execute(&state.pool).await {
        Ok(r) => (
            axum::http::StatusCode::OK,
            Json(BulkDeleteResponse {
                deleted: r.rows_affected(),
            }),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to bulk delete");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Database error",
            )
                .into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct DashboardStats {
    pub total_nodes: i64,
    pub pinned_count: i64,
    pub avg_heat: f64,
    pub type_distribution: Vec<TypeCount>,
    pub heat_distribution: HeatDistribution,
    pub namespace_counts: Vec<NamespaceCount>,
    pub recent_nodes: Vec<RecentNode>,
    /// Per-namespace type distribution: { "daedalus": [{ memory_type, count }, ...] }
    pub namespace_type_distribution: std::collections::HashMap<String, Vec<TypeCount>>,
    /// Per-namespace recent nodes: { "daedalus": [{ id, label, ... }, ...] }
    pub namespace_recent_nodes: std::collections::HashMap<String, Vec<RecentNode>>,
}

#[derive(Serialize)]
pub struct TypeCount {
    pub memory_type: String,
    pub count: i64,
}

#[derive(Serialize)]
pub struct HeatDistribution {
    pub frozen: i64,  // 0.0 - 0.2
    pub cool: i64,    // 0.2 - 0.4
    pub warm: i64,    // 0.4 - 0.6
    pub hot: i64,     // 0.6 - 0.8
    pub blazing: i64, // 0.8 - 1.0
}

#[derive(Serialize)]
pub struct NamespaceCount {
    pub namespace: String,
    pub count: i64,
}

#[derive(Serialize)]
pub struct RecentNode {
    pub id: String,
    pub label: String,
    pub memory_type: String,
    pub heat: f64,
    pub updated_at: String,
}

/// GET /api/v1/agent/storage — returns current usage vs limits for this tenant.
pub async fn storage_status(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = &tenant_ctx.id;
    let node_limit = tenant_ctx.effective_node_limit();

    let count_row =
        sqlx::query_as::<_, (i64,)>("SELECT count(*) FROM golden_index WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(&state.pool)
            .await;

    let current_nodes = match count_row {
        Ok((c,)) => c,
        Err(e) => {
            tracing::error!(error = %e, "storage_status: count query failed");
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to query storage",
            )
                .into_response();
        }
    };

    let utilization = if node_limit > 0 {
        (current_nodes as f64 / node_limit as f64 * 100.0).min(100.0)
    } else {
        0.0
    };

    (
        axum::http::StatusCode::OK,
        Json(serde_json::json!({
            "tenant_id": tenant_id,
            "plan_tier": tenant_ctx.plan_tier,
            "current_nodes": current_nodes,
            "max_nodes": if node_limit > 0 { serde_json::json!(node_limit) } else { serde_json::json!(null) },
            "utilization_pct": (utilization * 10.0).round() / 10.0,
            "ops_limit": tenant_ctx.effective_ops_limit(),
        })),
    )
        .into_response()
}

pub async fn dashboard_stats(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant_id = tenant_ctx.id;

    // Total + pinned + avg heat
    let totals = sqlx::query_as::<_, (i64, i64, f64)>(
        "SELECT count(*), \
         count(*) FILTER (WHERE is_pinned = true), \
         COALESCE(avg(current_heat::float8), 0) \
         FROM golden_index WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_one(pool)
    .await
    .unwrap_or((0, 0, 0.0));

    // Type distribution
    let type_rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT memory_type, count(*) FROM golden_index WHERE tenant_id = $1 GROUP BY memory_type ORDER BY count(*) DESC",
    )
    .bind(&tenant_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // Heat distribution (bucket by ranges)
    let heat_rows = sqlx::query_as::<_, (i64, i64, i64, i64, i64)>(
        "SELECT \
         count(*) FILTER (WHERE current_heat < 0.2), \
         count(*) FILTER (WHERE current_heat >= 0.2 AND current_heat < 0.4), \
         count(*) FILTER (WHERE current_heat >= 0.4 AND current_heat < 0.6), \
         count(*) FILTER (WHERE current_heat >= 0.6 AND current_heat < 0.8), \
         count(*) FILTER (WHERE current_heat >= 0.8) \
         FROM golden_index WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_one(pool)
    .await
    .unwrap_or((0, 0, 0, 0, 0));

    // Namespace counts
    let ns_rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT COALESCE(namespace, 'default'), count(*) FROM golden_index WHERE tenant_id = $1 GROUP BY namespace ORDER BY count(*) DESC LIMIT 10",
    )
    .bind(&tenant_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // Recent 10 nodes
    let recent_rows =
        sqlx::query_as::<_, (String, String, String, f32, chrono::DateTime<chrono::Utc>)>(
            "SELECT id::text, LEFT(pointer_summary, 200), memory_type, current_heat, updated_at \
         FROM golden_index WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 10",
        )
        .bind(&tenant_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    // Per-namespace type distribution
    let ns_type_rows = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT COALESCE(namespace, 'default'), memory_type, count(*) \
         FROM golden_index WHERE tenant_id = $1 \
         GROUP BY namespace, memory_type \
         ORDER BY namespace, count(*) DESC",
    )
    .bind(&tenant_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut ns_type_dist: std::collections::HashMap<String, Vec<TypeCount>> =
        std::collections::HashMap::new();
    for (ns, mt, count) in ns_type_rows {
        ns_type_dist.entry(ns).or_default().push(TypeCount {
            memory_type: mt,
            count,
        });
    }

    // Per-namespace recent 5 nodes
    let ns_recent_rows = sqlx::query_as::<_, (String, String, String, String, f32, chrono::DateTime<chrono::Utc>)>(
        "SELECT COALESCE(namespace, 'default'), id::text, LEFT(pointer_summary, 200), memory_type, current_heat, updated_at \
         FROM golden_index WHERE tenant_id = $1 \
         AND id IN ( \
           SELECT id FROM ( \
             SELECT id, namespace, ROW_NUMBER() OVER (PARTITION BY namespace ORDER BY updated_at DESC) AS rn \
             FROM golden_index WHERE tenant_id = $1 \
           ) sub WHERE rn <= 5 \
         ) ORDER BY namespace, updated_at DESC",
    )
    .bind(&tenant_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut ns_recent: std::collections::HashMap<String, Vec<RecentNode>> =
        std::collections::HashMap::new();
    for (ns, id, label, mt, heat, updated) in ns_recent_rows {
        ns_recent.entry(ns).or_default().push(RecentNode {
            id,
            label,
            memory_type: mt,
            heat: heat as f64,
            updated_at: updated.to_rfc3339(),
        });
    }

    let stats = DashboardStats {
        total_nodes: totals.0,
        pinned_count: totals.1,
        avg_heat: totals.2,
        type_distribution: type_rows
            .into_iter()
            .map(|(t, c)| TypeCount {
                memory_type: t,
                count: c,
            })
            .collect(),
        heat_distribution: HeatDistribution {
            frozen: heat_rows.0,
            cool: heat_rows.1,
            warm: heat_rows.2,
            hot: heat_rows.3,
            blazing: heat_rows.4,
        },
        namespace_counts: ns_rows
            .into_iter()
            .map(|(n, c)| NamespaceCount {
                namespace: n,
                count: c,
            })
            .collect(),
        recent_nodes: recent_rows
            .into_iter()
            .map(|(id, label, mt, heat, updated)| RecentNode {
                id,
                label,
                memory_type: mt,
                heat: heat as f64,
                updated_at: updated.to_rfc3339(),
            })
            .collect(),
        namespace_type_distribution: ns_type_dist,
        namespace_recent_nodes: ns_recent,
    };

    (axum::http::StatusCode::OK, Json(stats)).into_response()
}

// ---------------------------------------------------------------------------
// Bulk PATCH — update multiple memories in one call
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct BulkPatchItem {
    pub id: String,
    #[serde(flatten)]
    pub patch: PatchMemory,
}

#[derive(Deserialize)]
pub struct BulkPatchRequest {
    /// Individual patches per node ID.
    pub items: Option<Vec<BulkPatchItem>>,
    /// Or: apply the same patch to all nodes matching these IDs.
    pub ids: Option<Vec<String>>,
    /// The shared patch to apply when using `ids`.
    #[serde(flatten)]
    pub shared_patch: Option<PatchMemory>,
}

#[derive(Serialize)]
pub struct BulkPatchResponse {
    pub updated: u64,
    pub errors: Vec<String>,
}

pub async fn bulk_patch_memories(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<BulkPatchRequest>,
) -> impl IntoResponse {
    let acl = crate::db::load_namespace_acl(&state.pool, &tenant_ctx.id, &tenant_ctx.agent_label).await;
    let tenant_id = tenant_ctx.id;
    let mut total_updated = 0u64;
    let mut errors: Vec<String> = Vec::new();

    // Mode 1: individual patches per node
    if let Some(items) = req.items {
        for item in items {
            // ACL check: verify access to the memory's namespace
            if acl.has_identity {
                let ns = sqlx::query_scalar::<_, String>(
                    "SELECT COALESCE(namespace, 'default') FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid"
                )
                .bind(&tenant_id)
                .bind(&item.id)
                .fetch_optional(&state.pool)
                .await
                .unwrap_or(None)
                .unwrap_or_else(|| "default".to_string());
                if !acl.is_allowed(&ns) {
                    errors.push(format!("{}: namespace access denied", item.id));
                    continue;
                }
            }

            let patch = &item.patch;
            let mut sets = Vec::new();
            let mut bind_idx = 3u32;

            if patch.label.is_some() {
                sets.push(format!("pointer_summary = ${bind_idx}"));
                bind_idx += 1;
            }
            if patch.memory_type.is_some() {
                sets.push(format!("memory_type = ${bind_idx}"));
                bind_idx += 1;
            }
            if patch.is_pinned.is_some() {
                sets.push(format!("is_pinned = ${bind_idx}"));
                bind_idx += 1;
            }
            if patch.namespace.is_some() {
                sets.push(format!("namespace = ${bind_idx}"));
                bind_idx += 1;
            }
            if patch.current_heat.is_some() {
                sets.push(format!("current_heat = ${bind_idx}"));
                bind_idx += 1;
            }
            if patch.base_utility.is_some() {
                sets.push(format!("base_utility = ${bind_idx}"));
                bind_idx += 1;
            }
            let _ = bind_idx;

            if sets.is_empty() {
                continue;
            }
            sets.push("updated_at = now()".to_string());

            let sql = format!(
                "UPDATE golden_index SET {} WHERE tenant_id = $1 AND id = $2::uuid",
                sets.join(", ")
            );
            let mut q = sqlx::query(&sql).bind(&tenant_id).bind(&item.id);
            if let Some(ref v) = patch.label {
                q = q.bind(v);
            }
            if let Some(ref v) = patch.memory_type {
                q = q.bind(v);
            }
            if let Some(v) = patch.is_pinned {
                q = q.bind(v);
            }
            if let Some(ref v) = patch.namespace {
                q = q.bind(v);
            }
            if let Some(v) = patch.current_heat {
                q = q.bind(v);
            }
            if let Some(v) = patch.base_utility {
                q = q.bind(v);
            }

            match q.execute(&state.pool).await {
                Ok(r) => total_updated += r.rows_affected(),
                Err(e) => errors.push(format!("{}: {}", item.id, e)),
            }
        }
    }
    // Mode 2: shared patch applied to a list of IDs
    else if let (Some(ids), Some(patch)) = (req.ids, req.shared_patch) {
        for chunk in ids.chunks(50) {
            for id in chunk {
                let mut sets = Vec::new();
                let mut bind_idx = 3u32;

                if patch.label.is_some() {
                    sets.push(format!("pointer_summary = ${bind_idx}"));
                    bind_idx += 1;
                }
                if patch.memory_type.is_some() {
                    sets.push(format!("memory_type = ${bind_idx}"));
                    bind_idx += 1;
                }
                if patch.is_pinned.is_some() {
                    sets.push(format!("is_pinned = ${bind_idx}"));
                    bind_idx += 1;
                }
                if patch.namespace.is_some() {
                    sets.push(format!("namespace = ${bind_idx}"));
                    bind_idx += 1;
                }
                if patch.current_heat.is_some() {
                    sets.push(format!("current_heat = ${bind_idx}"));
                    bind_idx += 1;
                }
                if patch.base_utility.is_some() {
                    sets.push(format!("base_utility = ${bind_idx}"));
                    bind_idx += 1;
                }
                let _ = bind_idx;

                if sets.is_empty() {
                    break;
                }
                sets.push("updated_at = now()".to_string());

                let sql = format!(
                    "UPDATE golden_index SET {} WHERE tenant_id = $1 AND id = $2::uuid",
                    sets.join(", ")
                );
                let mut q = sqlx::query(&sql).bind(&tenant_id).bind(id);
                if let Some(ref v) = patch.label {
                    q = q.bind(v);
                }
                if let Some(ref v) = patch.memory_type {
                    q = q.bind(v);
                }
                if let Some(v) = patch.is_pinned {
                    q = q.bind(v);
                }
                if let Some(ref v) = patch.namespace {
                    q = q.bind(v);
                }
                if let Some(v) = patch.current_heat {
                    q = q.bind(v);
                }
                if let Some(v) = patch.base_utility {
                    q = q.bind(v);
                }

                match q.execute(&state.pool).await {
                    Ok(r) => total_updated += r.rows_affected(),
                    Err(e) => errors.push(format!("{}: {}", id, e)),
                }
            }
        }
    }

    (
        axum::http::StatusCode::OK,
        Json(BulkPatchResponse {
            updated: total_updated,
            errors,
        }),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// Auth Verify — validate API key and return identity/tier/limits
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Consolidation / Fold — piggyback protocol
// ---------------------------------------------------------------------------

/// POST /api/v1/agent/fold
///
/// The fold endpoint: an agent submits a consolidated summary for a cluster of
/// cold memories. The server creates a new "synthesis" node, links it to the
/// source nodes via golden_edges, and optionally marks source nodes as folded.
///
/// This is the "piggyback" protocol — the agent's LLM does the summarization,
/// the server just records the result. Zero LLM cost to us.
#[derive(Deserialize)]
pub struct FoldRequest {
    /// IDs of the source memories being consolidated.
    pub source_ids: Vec<String>,
    /// The consolidated summary text (generated by the agent's LLM).
    pub summary: String,
    /// Namespace for the new synthesis node (defaults to source namespace).
    pub namespace: Option<String>,
}

#[derive(Serialize)]
pub struct FoldResponse {
    pub synthesis_id: String,
    pub sources_linked: usize,
    pub sources_cooled: usize,
}

pub async fn handle_fold(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<FoldRequest>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;

    // Validate
    if req.source_ids.is_empty() || req.source_ids.len() > 50 {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "source_ids must contain 1-50 IDs" })),
        ).into_response();
    }
    if req.summary.trim().is_empty() || req.summary.len() > 10_000 {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "summary must be 1-10,000 characters" })),
        ).into_response();
    }

    // Resolve namespace from first source node if not provided
    let namespace = if let Some(ns) = req.namespace {
        crate::middleware::sanitize_namespace(&ns)
    } else {
        sqlx::query_scalar::<_, String>(
            "SELECT namespace FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid"
        )
        .bind(&tenant_id)
        .bind(&req.source_ids[0])
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "default".to_string())
    };

    // Create the synthesis node at moderate heat (consolidated knowledge persists)
    let synthesis_id = uuid::Uuid::now_v7();
    let insert = sqlx::query(
        "INSERT INTO golden_index (tenant_id, id, pointer_summary, memory_type, current_heat, namespace, modality, updated_at)
         VALUES ($1, $2, $3, 'synthesis', 0.6, $4, 'text', now())"
    )
    .bind(&tenant_id)
    .bind(synthesis_id)
    .bind(&req.summary)
    .bind(&namespace)
    .execute(&state.pool)
    .await;

    if let Err(e) = insert {
        tracing::error!(error = %e, "fold: failed to create synthesis node");
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    // Link synthesis node to sources via golden_edges
    let mut linked = 0usize;
    for source_id in &req.source_ids {
        let edge_res = sqlx::query(
            "INSERT INTO golden_edges (tenant_id, source_id, target_id, edge_type, weight, updated_at)
             VALUES ($1, $2::uuid, $3, 'consolidation', 1.0, now())
             ON CONFLICT (tenant_id, source_id, target_id) DO UPDATE SET edge_type = 'consolidation', weight = 1.0, updated_at = now()"
        )
        .bind(&tenant_id)
        .bind(source_id)
        .bind(synthesis_id)
        .execute(&state.pool)
        .await;

        if edge_res.is_ok() {
            linked += 1;
        }
    }

    // Cool the source nodes — they've been folded into the synthesis
    let mut cooled = 0usize;
    for source_id in &req.source_ids {
        let cool_res = sqlx::query(
            "UPDATE golden_index SET current_heat = GREATEST(current_heat * 0.3, 0.01), updated_at = now()
             WHERE tenant_id = $1 AND id = $2::uuid AND is_pinned = false"
        )
        .bind(&tenant_id)
        .bind(source_id)
        .execute(&state.pool)
        .await;

        if let Ok(r) = cool_res {
            if r.rows_affected() > 0 {
                cooled += 1;
            }
        }
    }

    // Activity log
    let pool = state.pool.clone();
    let tid = tenant_id.clone();
    let ns_clone = namespace.clone();
    let src_count = req.source_ids.len();
    tokio::spawn(async move {
        let _ = crate::activity::log_activity(
            &pool, &tid, "api", "memory.fold",
            Some(synthesis_id), Some(ns_clone.as_str()),
            Some(serde_json::json!({ "sources": src_count, "linked": linked, "cooled": cooled })),
        ).await;
    });

    tracing::info!(tenant_id = %tenant_id, synthesis_id = %synthesis_id, sources = req.source_ids.len(), linked, cooled, "fold completed");

    (
        axum::http::StatusCode::CREATED,
        Json(FoldResponse {
            synthesis_id: synthesis_id.to_string(),
            sources_linked: linked,
            sources_cooled: cooled,
        }),
    ).into_response()
}

/// GET /api/v1/agent/consolidation-candidates
///
/// Returns clusters of cold memories that are candidates for consolidation.
/// The agent can use these to generate a summary and POST it to /api/v1/agent/fold.
pub async fn consolidation_candidates(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;

    // Find cold episodic memories (heat < 0.15) grouped by namespace
    // Return up to 3 clusters of 3-10 nodes each
    let cold_nodes: Vec<(String, String, f32, String)> = sqlx::query_as(
        "SELECT id::text, pointer_summary, current_heat, namespace \
         FROM golden_index \
         WHERE tenant_id = $1 AND memory_type = 'episodic' AND current_heat < 0.15 AND is_pinned = false \
         ORDER BY namespace, current_heat ASC \
         LIMIT 30"
    )
    .bind(&tenant_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    // Group by namespace
    let mut clusters: std::collections::HashMap<String, Vec<serde_json::Value>> = std::collections::HashMap::new();
    for (id, summary, heat, ns) in cold_nodes {
        let entry = clusters.entry(ns.clone()).or_default();
        if entry.len() < 10 {
            entry.push(serde_json::json!({
                "id": id,
                "summary": summary,
                "heat": heat,
                "namespace": ns,
            }));
        }
    }

    // Only return clusters with 3+ nodes (worth consolidating)
    let result: Vec<serde_json::Value> = clusters
        .into_iter()
        .filter(|(_, nodes)| nodes.len() >= 3)
        .take(3)
        .map(|(ns, nodes)| serde_json::json!({
            "namespace": ns,
            "node_count": nodes.len(),
            "nodes": nodes,
        }))
        .collect();

    (axum::http::StatusCode::OK, Json(serde_json::json!({
        "clusters": result,
        "total_candidates": result.iter().map(|c| c["node_count"].as_u64().unwrap_or(0)).sum::<u64>(),
    }))).into_response()
}

/// POST /api/v1/agent/consolidate
///
/// Merges, prunes, or archives cold memories below the given heat threshold.
/// Returns actions taken (deleted, merged, archived).
pub async fn consolidate_memories(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let min_heat = body.get("min_heat").and_then(|v| v.as_f64()).unwrap_or(0.1) as f32;
    let eff_ns = tenant_ctx.effective_namespace();
    let tenant_id = tenant_ctx.id;
    let agent_label = tenant_ctx.agent_label.clone();

    // Default to agent's own namespace
    let namespace = body.get("namespace")
        .and_then(|v| v.as_str())
        .map(|s| crate::middleware::sanitize_namespace(s))
        .unwrap_or(eff_ns);

    // Check namespace access
    if !crate::db::check_namespace_access(&state.pool, &tenant_id, &agent_label, &namespace).await {
        return (axum::http::StatusCode::FORBIDDEN, "Access denied to this namespace").into_response();
    }

    // Find cold, unpinned, non-archived memories in this namespace
    let cold: Vec<(String, String, f32, String)> = sqlx::query_as(
        "SELECT id::text, pointer_summary, current_heat, COALESCE(memory_type, 'episodic') \
         FROM golden_index \
         WHERE tenant_id = $1 AND namespace = $2 \
         AND current_heat < $3 AND is_pinned = false AND is_locked = false \
         AND archived_at IS NULL \
         ORDER BY current_heat ASC \
         LIMIT 50"
    )
    .bind(&tenant_id)
    .bind(&namespace)
    .bind(min_heat)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    if cold.is_empty() {
        return (axum::http::StatusCode::OK, Json(serde_json::json!({
            "action": "consolidate",
            "archived": 0,
            "namespace": namespace,
            "message": "No cold memories found below threshold",
        }))).into_response();
    }

    // Soft-delete: set archived_at + log to archive_log (recoverable for 30 days)
    let mut archived = 0u32;
    for (id, summary, heat, mem_type) in &cold {
        // Set archived_at on the node
        let r = sqlx::query(
            "UPDATE golden_index SET archived_at = NOW() \
             WHERE tenant_id = $1 AND id = $2::uuid AND archived_at IS NULL"
        )
        .bind(&tenant_id)
        .bind(id)
        .execute(&state.pool)
        .await;

        if let Ok(res) = r {
            if res.rows_affected() > 0 {
                archived += 1;
                // Write audit trail
                let _ = sqlx::query(
                    "INSERT INTO archive_log \
                        (tenant_id, node_id, namespace, pointer_summary, memory_type, \
                         current_heat, archived_by, reason) \
                     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, 'consolidate')"
                )
                .bind(&tenant_id)
                .bind(id)
                .bind(&namespace)
                .bind(summary)
                .bind(mem_type)
                .bind(heat)
                .bind(&agent_label)
                .execute(&state.pool)
                .await;

                // Mark as archived in AGE graph
                if let Ok(uid) = uuid::Uuid::parse_str(id) {
                    crate::graph::archive_memory_vertex(
                        &state.pool, &tenant_id, &uid,
                    ).await;
                }
            }
        }
    }

    // Log activity
    let pool = state.pool.clone();
    let tid = tenant_id.clone();
    let ns = namespace.clone();
    tokio::spawn(async move {
        let _ = crate::activity::log_activity(
            &pool, &tid, "api", "consolidate",
            None, Some(&format!("Archived {archived} cold nodes in {ns} (soft-delete, recoverable 30 days)")), None,
        ).await;
    });

    (axum::http::StatusCode::OK, Json(serde_json::json!({
        "action": "consolidate",
        "archived": archived,
        "namespace": namespace,
        "threshold": min_heat,
        "candidates": cold.len(),
        "recoverable": true,
        "retention_days": 30,
        "message": format!("Archived {} memories (recoverable via POST /agent/restore)", archived),
    }))).into_response()
}

/// POST /api/v1/agent/restore
///
/// Restore archived (soft-deleted) memories. Accepts a list of node IDs or "all" for namespace.
pub async fn restore_memories(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let eff_ns_restore = tenant_ctx.effective_namespace();
    let tenant_id = tenant_ctx.id;
    let agent_label = tenant_ctx.agent_label.clone();

    let namespace = body.get("namespace")
        .and_then(|v| v.as_str())
        .map(|s| crate::middleware::sanitize_namespace(s))
        .unwrap_or(eff_ns_restore);

    if !crate::db::check_namespace_access(&state.pool, &tenant_id, &agent_label, &namespace).await {
        return (axum::http::StatusCode::FORBIDDEN, "Access denied to this namespace").into_response();
    }

    // Restore specific IDs or all archived in namespace
    let node_ids: Option<Vec<String>> = body.get("ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

    let restored = if let Some(ids) = node_ids {
        let mut count = 0u32;
        for id in &ids {
            let r = sqlx::query(
                "UPDATE golden_index SET archived_at = NULL \
                 WHERE tenant_id = $1 AND id = $2::uuid AND archived_at IS NOT NULL"
            )
            .bind(&tenant_id)
            .bind(id)
            .execute(&state.pool)
            .await;
            if let Ok(res) = r {
                if res.rows_affected() > 0 { count += 1; }
            }
        }
        count
    } else {
        // Restore all archived in namespace
        let r = sqlx::query(
            "UPDATE golden_index SET archived_at = NULL \
             WHERE tenant_id = $1 AND namespace = $2 AND archived_at IS NOT NULL"
        )
        .bind(&tenant_id)
        .bind(&namespace)
        .execute(&state.pool)
        .await;
        r.map(|res| res.rows_affected() as u32).unwrap_or(0)
    };

    // Log
    let pool = state.pool.clone();
    let tid = tenant_id.clone();
    let ns = namespace.clone();
    tokio::spawn(async move {
        let _ = crate::activity::log_activity(
            &pool, &tid, "api", "restore",
            None, Some(&format!("Restored {restored} archived nodes in {ns}")), None,
        ).await;
    });

    (axum::http::StatusCode::OK, Json(serde_json::json!({
        "action": "restore",
        "restored": restored,
        "namespace": namespace,
    }))).into_response()
}

/// GET /api/v1/agent/archive
///
/// List archived memories (for review before restore or permanent deletion).
pub async fn list_archived(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    let agent_label = tenant_ctx.agent_label.clone();
    let namespace = if agent_label.is_empty() { "default".to_string() } else { agent_label };

    let rows: Vec<(String, String, f32, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT id::text, pointer_summary, current_heat, COALESCE(memory_type, 'episodic'), archived_at \
         FROM golden_index \
         WHERE tenant_id = $1 AND namespace = $2 AND archived_at IS NOT NULL \
         ORDER BY archived_at DESC \
         LIMIT 100"
    )
    .bind(&tenant_id)
    .bind(&namespace)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let items: Vec<serde_json::Value> = rows.iter().map(|(id, summary, heat, mt, archived)| {
        serde_json::json!({
            "id": id,
            "summary": summary,
            "heat": heat,
            "memory_type": mt,
            "archived_at": archived.to_rfc3339(),
        })
    }).collect();

    (axum::http::StatusCode::OK, Json(serde_json::json!({
        "archived": items,
        "count": items.len(),
        "namespace": namespace,
    }))).into_response()
}

/// GET /api/v1/auth/verify
///
/// Returns the authenticated identity, plan tier, and limits for the given API key.
/// Useful for testing key validity without side effects.
// ---------------------------------------------------------------------------
// Conflict Detection — detect contradictions on store, expose via API
// ---------------------------------------------------------------------------

/// Compute a simple Levenshtein similarity ratio in [0.0, 1.0].
/// ratio = 1.0 - (edit_distance / max(len_a, len_b))
/// Works on char sequences. Bounded: inputs longer than 2000 chars are truncated for perf.
fn levenshtein_ratio(a: &str, b: &str) -> f32 {
    const MAX_LEN: usize = 2000;
    let a: Vec<char> = a.chars().take(MAX_LEN).collect();
    let b: Vec<char> = b.chars().take(MAX_LEN).collect();
    let la = a.len();
    let lb = b.len();
    if la == 0 && lb == 0 { return 1.0; }
    let max_len = la.max(lb);
    if la == 0 || lb == 0 { return 0.0; }

    // Standard DP, two-row approach
    let mut prev: Vec<usize> = (0..=lb).collect();
    let mut curr = vec![0usize; lb + 1];
    for i in 1..=la {
        curr[0] = i;
        for j in 1..=lb {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            curr[j] = (prev[j] + 1)
                .min(curr[j - 1] + 1)
                .min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    let dist = prev[lb];
    1.0 - (dist as f32 / max_len as f32)
}

/// Detect conflicts for a newly stored node and insert into `conflicts` table.
/// Fires `on_conflict` trigger for each detected conflict.
/// Called fire-and-forget from `create_memory`.
async fn detect_conflicts(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    node_id: uuid::Uuid,
    namespace: &str,
    summary: &str,
    embedding: &[f32],
) {
    use pgvector::Vector;
    const SIMILARITY_THRESHOLD: f64 = 0.85;
    const LEV_RATIO_THRESHOLD: f32 = 0.7;

    let qvec = Vector::from(embedding.to_vec());
    // Query existing nodes with cosine similarity > threshold (distance < 1 - threshold)
    let max_distance = 1.0 - SIMILARITY_THRESHOLD;
    let rows = sqlx::query_as::<_, (uuid::Uuid, String, f64)>(
        "SELECT id, pointer_summary, (embedding <=> $2::vector) AS distance
         FROM golden_index
         WHERE tenant_id = $1
           AND namespace = $3
           AND id != $4
           AND embedding IS NOT NULL
           AND archived_at IS NULL
           AND (embedding <=> $2::vector) < $5
         LIMIT 20",
    )
    .bind(tenant_id)
    .bind(&qvec)
    .bind(namespace)
    .bind(node_id)
    .bind(max_distance)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for (other_id, other_summary, distance) in rows {
        let similarity = (1.0 - distance) as f32;
        let lev = levenshtein_ratio(summary, &other_summary);

        // High vector similarity but very different text = likely contradiction
        if lev < LEV_RATIO_THRESHOLD {
            // Ensure node_a_id < node_b_id for the UNIQUE constraint
            let (node_a, node_b) = if node_id < other_id {
                (node_id, other_id)
            } else {
                (other_id, node_id)
            };

            let inserted = sqlx::query_scalar::<_, uuid::Uuid>(
                "INSERT INTO conflicts (tenant_id, namespace, node_a_id, node_b_id, similarity)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (tenant_id, node_a_id, node_b_id) DO NOTHING
                 RETURNING id",
            )
            .bind(tenant_id)
            .bind(namespace)
            .bind(node_a)
            .bind(node_b)
            .bind(similarity)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

            if inserted.is_some() {
                tracing::debug!(
                    tenant = %tenant_id,
                    node_a = %node_a,
                    node_b = %node_b,
                    similarity,
                    lev_ratio = lev,
                    "conflict detected"
                );

                // Fire on_conflict trigger
                let ctx = crate::trigger_engine::TriggerContext {
                    tenant_id: tenant_id.to_string(),
                    node_id: Some(node_id.to_string()),
                    node_label: None,
                    node_namespace: Some(namespace.to_string()),
                    node_memory_type: None,
                    node_heat: None,
                    old_heat: None,
                };
                let _ = crate::trigger_engine::evaluate_triggers(
                    pool,
                    crate::trigger_engine::TriggerEvent::OnConflict,
                    &ctx,
                )
                .await;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// GET /api/v1/agent/conflicts
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ConflictsQuery {
    pub status: Option<String>,
    pub namespace: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list_conflicts(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Query(params): Query<ConflictsQuery>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    let status = params.status.as_deref().unwrap_or("open");
    let limit = params.limit.unwrap_or(20).min(100);
    let conflict_ns = crate::middleware::sanitize_ns_opt(params.namespace);

    let rows = if let Some(ref ns) = conflict_ns {
        sqlx::query(
            "SELECT id, tenant_id, namespace, node_a_id, node_b_id, similarity, status, resolved_at, created_at
             FROM conflicts
             WHERE tenant_id = $1 AND status = $2 AND namespace = $3
             ORDER BY created_at DESC LIMIT $4",
        )
        .bind(&tenant_id).bind(status).bind(ns).bind(limit)
        .fetch_all(&state.pool).await
    } else {
        sqlx::query(
            "SELECT id, tenant_id, namespace, node_a_id, node_b_id, similarity, status, resolved_at, created_at
             FROM conflicts
             WHERE tenant_id = $1 AND status = $2
             ORDER BY created_at DESC LIMIT $3",
        )
        .bind(&tenant_id).bind(status).bind(limit)
        .fetch_all(&state.pool).await
    };

    match rows {
        Ok(rows) => {
            let items: Vec<serde_json::Value> = rows.iter().map(|r| {
                serde_json::json!({
                    "id": r.get::<uuid::Uuid, _>("id"),
                    "namespace": r.get::<Option<String>, _>("namespace"),
                    "node_a_id": r.get::<uuid::Uuid, _>("node_a_id"),
                    "node_b_id": r.get::<uuid::Uuid, _>("node_b_id"),
                    "similarity": r.get::<f32, _>("similarity"),
                    "status": r.get::<String, _>("status"),
                    "resolved_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("resolved_at"),
                    "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
                })
            }).collect();
            (axum::http::StatusCode::OK, Json(serde_json::json!({ "conflicts": items }))).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch conflicts");
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/agent/conflicts/:id
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ResolveConflict {
    pub status: String,
}

pub async fn resolve_conflict(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    axum::extract::Path(conflict_id): axum::extract::Path<String>,
    Json(body): Json<ResolveConflict>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    if !matches!(body.status.as_str(), "resolved" | "dismissed") {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "status must be 'resolved' or 'dismissed'" })),
        ).into_response();
    }

    let result = sqlx::query(
        "UPDATE conflicts
         SET status = $1, resolved_at = now()
         WHERE id = $2::uuid AND tenant_id = $3 AND status = 'open'",
    )
    .bind(&body.status)
    .bind(&conflict_id)
    .bind(&tenant_id)
    .execute(&state.pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => (
            axum::http::StatusCode::OK,
            Json(serde_json::json!({ "id": conflict_id, "status": body.status })),
        ).into_response(),
        Ok(_) => (axum::http::StatusCode::NOT_FOUND, "Conflict not found or already resolved").into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to resolve conflict");
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response()
        }
    }
}

// ---------------------------------------------------------------------------

pub async fn handle_auth_verify(
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let unlimited = |v: i64| -> serde_json::Value {
        if v <= 0 || v >= 9_000_000_000 {
            serde_json::json!("unlimited")
        } else {
            serde_json::json!(v)
        }
    };

    (
        axum::http::StatusCode::OK,
        Json(serde_json::json!({
            "authenticated": true,
            "tenant_id": tenant_ctx.id,
            "plan_tier": tenant_ctx.plan_tier,
            "agent_label": if tenant_ctx.agent_label.is_empty() { None } else { Some(&tenant_ctx.agent_label) },
            "limits": {
                "ops_per_month": unlimited(tenant_ctx.effective_ops_limit()),
                "max_nodes": unlimited(tenant_ctx.effective_node_limit()),
                "max_agents": tenant_ctx.max_agents,
                "max_sync_requests": unlimited(tenant_ctx.max_sync_requests.unwrap_or(-1)),
            },
            "features": tenant_ctx.features,
        })),
    )
}

// ---------------------------------------------------------------------------
// Entity Context (Phase 5 — Graph-Aware Context Enrichment)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct EntityContextRequest {
    pub entity_names: Vec<String>,
    pub namespace: Option<String>,
    pub limit: Option<u32>,
}

/// POST /api/v1/agent/entity-context
///
/// Returns graph-connected memories and sibling entities for a set of entity names.
/// Used by the plugin recall pipeline to enrich prompt context with relationship data.
/// If AGE is not available, returns an empty `entities` array (graceful degradation).
pub async fn handle_entity_context(
    State(state): State<crate::SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<EntityContextRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant_id = &tenant_ctx.id;
    let limit = req.limit.unwrap_or(3).min(20) as usize;

    if !crate::graph::graph_available(pool).await {
        return (
            axum::http::StatusCode::OK,
            Json(serde_json::json!({ "entities": [] })),
        )
        .into_response();
    }

    let tenant_escaped = tenant_id.replace('\'', "\\'");
    let ns_filter = match &req.namespace {
        Some(ns) if !ns.is_empty() => {
            let ns_escaped = ns.replace('\'', "\\'");
            format!(", namespace: '{ns_escaped}'")
        }
        _ => String::new(),
    };

    let mut entities_out: Vec<serde_json::Value> = Vec::new();

    for entity_name in req.entity_names.iter().take(10) {
        if entity_name.trim().is_empty() {
            continue;
        }
        // Lowercase for case-insensitive CONTAINS match (mirrors temporal_query pattern)
        let name_lower = entity_name.to_lowercase().replace('\'', "\\'");

        // Step 1: find matching Entity vertices by name
        let find_cypher = format!(
            "MATCH (e:Entity {{tenant_id: '{tenant_escaped}'{ns_filter}}}) \
             WHERE e.name CONTAINS '{name_lower}' \
             RETURN e.name, e.entity_type \
             LIMIT 5",
        );

        let entity_matches = match crate::graph::cypher_query_cols(
            pool,
            &find_cypher,
            &["ename", "etype"],
        )
        .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::debug!(error = %e, name = %entity_name, "entity_context: entity lookup failed");
                continue;
            }
        };

        for entity_val in entity_matches {
            let matched_name = match entity_val.get("ename").and_then(|v| v.as_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let entity_type = entity_val
                .get("etype")
                .and_then(|v| v.as_str())
                .unwrap_or("concept")
                .to_string();

            let matched_escaped = matched_name.replace('\'', "\\'");

            // Step 2: find connected Memory vertices (1-hop)
            let mem_cypher = format!(
                "MATCH (e:Entity {{tenant_id: '{tenant_escaped}', name: '{matched_escaped}'}})\
                 -[r]-(m:Memory {{tenant_id: '{tenant_escaped}'}}) \
                 RETURN m.id \
                 LIMIT {limit}",
            );

            let mem_ids: Vec<String> =
                match crate::graph::cypher_query_cols(pool, &mem_cypher, &["mid"]).await {
                    Ok(rows) => rows
                        .iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect(),
                    Err(_) => vec![],
                };

            // Step 3: find connected Entity vertices (1-hop)
            let conn_cypher = format!(
                "MATCH (e:Entity {{tenant_id: '{tenant_escaped}', name: '{matched_escaped}'}})\
                 -[r]-(other:Entity {{tenant_id: '{tenant_escaped}'}}) \
                 RETURN other.name, r.relationship_label \
                 LIMIT 10",
            );

            let connections: Vec<serde_json::Value> =
                match crate::graph::cypher_query_cols(pool, &conn_cypher, &["oname", "rel"]).await
                {
                    Ok(rows) => rows
                        .iter()
                        .map(|v| {
                            serde_json::json!({
                                "name": v.get("oname").and_then(|v| v.as_str()).unwrap_or(""),
                                "relationship": v.get("rel").and_then(|v| v.as_str()).unwrap_or("connected"),
                            })
                        })
                        .collect(),
                    Err(_) => vec![],
                };

            // Step 4: join with golden_index for memory details
            let related_memories: Vec<serde_json::Value> = if !mem_ids.is_empty() {
                match sqlx::query(
                    "SELECT id::text, pointer_summary, memory_type, current_heat \
                     FROM golden_index \
                     WHERE tenant_id = $1 AND id::text = ANY($2) \
                     AND archived_at IS NULL \
                     ORDER BY current_heat DESC \
                     LIMIT $3",
                )
                .bind(tenant_id)
                .bind(&mem_ids)
                .bind(limit as i64)
                .fetch_all(pool)
                .await
                {
                    Ok(rows) => rows
                        .iter()
                        .map(|r| {
                            serde_json::json!({
                                "id": r.get::<String, _>("id"),
                                "pointer_summary": r.get::<String, _>("pointer_summary"),
                                "memory_type": r.get::<Option<String>, _>("memory_type")
                                    .unwrap_or_else(|| "episodic".to_string()),
                                "current_heat": r.get::<f32, _>("current_heat"),
                            })
                        })
                        .collect(),
                    Err(e) => {
                        tracing::debug!(error = %e, "entity_context: golden_index join failed");
                        vec![]
                    }
                }
            } else {
                vec![]
            };

            entities_out.push(serde_json::json!({
                "name": matched_name,
                "type": entity_type,
                "related_memories": related_memories,
                "connections": connections,
            }));
        }
    }

    (
        axum::http::StatusCode::OK,
        Json(serde_json::json!({ "entities": entities_out })),
    )
    .into_response()
}

// ─── POST /api/v1/agent/recall-log ─────────────────────────────────────────

/// Log a recall session for SIRU training data.
/// Called by the plugin after each context injection.
#[derive(Debug, Deserialize)]
pub struct RecallLogRequest {
    pub namespace: Option<String>,
    pub agent_id: Option<String>,
    pub query_text: String,
    pub memory_ids: Vec<String>,
    pub memory_scores: Vec<f32>,
    pub memory_sources: Vec<String>,
    pub token_budget: i32,
    pub tokens_used: i32,
    pub candidates_total: i32,
    pub candidates_selected: i32,
    pub semantic_count: i32,
    pub hot_count: i32,
    pub entity_count: i32,
    pub entity_hints: Vec<String>,
}

pub async fn handle_recall_log(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<RecallLogRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant_id = &tenant_ctx.id;
    let recall_ns = crate::middleware::sanitize_ns_opt(req.namespace);
    let namespace = recall_ns.as_deref().unwrap_or("default");

    let result = sqlx::query(
        r#"INSERT INTO recall_sessions
           (tenant_id, namespace, agent_id, query_text,
            memory_ids, memory_scores, memory_sources,
            token_budget, tokens_used, candidates_total, candidates_selected,
            semantic_count, hot_count, entity_count, entity_hints)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(namespace)
    .bind(&req.agent_id)
    .bind(&req.query_text)
    .bind(&req.memory_ids)
    .bind(&req.memory_scores)
    .bind(&req.memory_sources)
    .bind(req.token_budget)
    .bind(req.tokens_used)
    .bind(req.candidates_total)
    .bind(req.candidates_selected)
    .bind(req.semantic_count)
    .bind(req.hot_count)
    .bind(req.entity_count)
    .bind(&req.entity_hints)
    .fetch_one(pool)
    .await;

    match result {
        Ok(row) => {
            let id: uuid::Uuid = row.get("id");
            tracing::debug!(tenant = %tenant_id, namespace = %namespace, id = %id, "recall session logged");
            (axum::http::StatusCode::OK, Json(serde_json::json!({ "ok": true, "id": id.to_string() }))).into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "recall_log insert failed");
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "ok": false, "error": "insert_failed" }))).into_response()
        }
    }
}

// ─── POST /api/v1/agent/boost-batch ─────────────────────────────────────────
//
// Task 37: Batch heat-boost endpoint.
// Accepts an array of { id, heat } pairs where `heat` is the desired new current_heat
// (already computed + clamped by the plugin client, e.g. min(current_heat + delta, 0.98)).
// Updates all matching memories for the calling tenant in a single query.
// Returns { ok: true, updated: N } on success.
//
// Plugin client (openclaw-sulcus ≥ v5.5.1) calls this first; falls back to N individual
// PATCHes if this endpoint returns 404 (server < 2.11.0).

#[derive(Deserialize)]
pub struct BoostBatchItem {
    pub id: String,
    /// New target heat value, already computed and clamped by the client (0.0–1.0).
    pub heat: f32,
}

#[derive(Deserialize)]
pub struct BoostBatchRequest {
    pub boosts: Vec<BoostBatchItem>,
}

pub async fn handle_boost_batch(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<BoostBatchRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let tenant_id = &tenant_ctx.id;

    if req.boosts.is_empty() {
        return (axum::http::StatusCode::OK, Json(serde_json::json!({ "ok": true, "updated": 0 }))).into_response();
    }

    // Cap batch size to prevent abuse
    const MAX_BATCH: usize = 100;
    if req.boosts.len() > MAX_BATCH {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "ok": false,
                "error": format!("batch too large: max {} items", MAX_BATCH)
            }))
        ).into_response();
    }

    // Parse and validate all UUIDs up front
    let mut ids: Vec<uuid::Uuid> = Vec::with_capacity(req.boosts.len());
    let mut heats: Vec<f32> = Vec::with_capacity(req.boosts.len());
    for item in &req.boosts {
        match uuid::Uuid::parse_str(&item.id) {
            Ok(uid) => {
                ids.push(uid);
                // Clamp heat server-side too — belt-and-suspenders
                heats.push(item.heat.clamp(0.0, 1.0));
            }
            Err(_) => {
                return (
                    axum::http::StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "ok": false, "error": format!("invalid uuid: {}", item.id) }))
                ).into_response();
            }
        }
    }

    // Build an unnest-based bulk UPDATE:
    // UPDATE golden_index SET current_heat = LEAST(v.heat, 1.0), updated_at = now()
    //   FROM (SELECT unnest($2::uuid[]) AS id, unnest($3::float4[]) AS heat) AS v
    //   WHERE tenant_id = $1 AND golden_index.id = v.id
    let result = sqlx::query(
        "UPDATE golden_index \
           SET current_heat = LEAST(v.heat::float4, 1.0), updated_at = now() \
           FROM (SELECT unnest($2::uuid[]) AS id, unnest($3::float4[]) AS heat) AS v \
           WHERE golden_index.tenant_id = $1 AND golden_index.id = v.id",
    )
    .bind(tenant_id)
    .bind(&ids)
    .bind(&heats)
    .execute(pool)
    .await;

    match result {
        Ok(r) => {
            let updated = r.rows_affected();
            tracing::debug!(
                tenant = %tenant_id,
                submitted = req.boosts.len(),
                updated = updated,
                "boost-batch: applied"
            );
            (axum::http::StatusCode::OK, Json(serde_json::json!({ "ok": true, "updated": updated }))).into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "boost-batch update failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "ok": false, "error": "update_failed" }))
            ).into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// Recall Test Harness (Task 64 — full pipeline transparency for debugging)
// ---------------------------------------------------------------------------

/// Request for the recall test harness endpoint.
#[derive(serde::Deserialize)]
pub struct RecallTestRequest {
    /// The query to test. Same text that would come from a user message.
    pub query: String,
    /// Optional namespace to scope the search. Defaults to agent's own namespace.
    pub namespace: Option<String>,
    /// How many results to return. Default 10, max 20.
    pub limit: Option<u32>,
    /// Include per-result scoring breakdown. Default true for this endpoint.
    #[serde(default = "default_true")]
    pub explain: bool,
}

fn default_true() -> bool { true }

/// POST /api/v2/recall/test
///
/// Test harness that exposes the full recall pipeline in a single request.
/// Returns:
/// - `pipeline_config`: the scoring weights in use for this tenant
/// - `vector_results`: raw search results with scoring explain
/// - `entity_expansion`: graph neighbors found for entities in the query/results
/// - `context_xml`: what would be assembled into the prompt context block
/// - `token_estimate`: approximate tokens the context block would consume
/// - `search_method`: "semantic" or "full_text"
/// - `temporal_window`: detected temporal filter (if any)
///
/// This endpoint does NOT fire heat boosts or resonance — it is read-only.
pub async fn handle_recall_test(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(mut req): Json<RecallTestRequest>,
) -> impl IntoResponse {
    let limit = req.limit.unwrap_or(10).min(20) as i64;
    let tenant_id = tenant_ctx.id.clone();
    let acl = crate::db::load_namespace_acl(&state.pool, &tenant_id, &tenant_ctx.agent_label).await;

    // Resolve namespace
    req.namespace = crate::middleware::sanitize_ns_opt(req.namespace);
    if req.namespace.is_none() {
        let ens = tenant_ctx.effective_namespace();
        if ens != "default" {
            req.namespace = Some(ens);
        }
    }

    // Load scoring config
    let thermo_config = crate::thermo_api::load_tenant_config(&state.pool, &tenant_id).await;
    let kw_weight = thermo_config.recall.keyword_weight;
    let ns_boost = thermo_config.recall.namespace_boost;
    let query_tokens = tokenize(&req.query);
    let temporal_window = crate::temporal::extract_temporal_window(&req.query, None);
    let query_namespace = req.namespace.clone();

    // Pipeline config to expose
    let pipeline_config = serde_json::json!({
        "similarity_weight": thermo_config.recall.similarity_weight,
        "heat_weight": thermo_config.recall.heat_weight,
        "type_heat_weights": thermo_config.recall.type_heat_weights,
        "keyword_weight": kw_weight,
        "temporal_max_boost": thermo_config.recall.temporal_max_boost,
        "temporal_decay_days": thermo_config.recall.temporal_decay_days,
        "namespace_boost": ns_boost,
    });

    // --- Phase 1: Try semantic (vector) search ---
    let archive_filter = "AND archived_at IS NULL";
    let semantic_rows = state.embed_query(&req.query).map(|qvec| pgvector::Vector::from(qvec));

    let (rows, search_method) = if let Some(query_vec) = semantic_rows {
        let result = if let Some(ref ns) = req.namespace {
            sqlx::query(&format!(
                "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                 memory_type, modality, source_mime, namespace, confidence, updated_at, \
                 (embedding <=> $2::vector) AS distance \
                 FROM golden_index \
                 WHERE tenant_id = $1 AND embedding IS NOT NULL \
                 AND namespace = $3 {archive_filter} \
                 ORDER BY embedding <=> $2::vector \
                 LIMIT $4",
            ))
            .bind(&tenant_id).bind(&query_vec).bind(ns).bind(limit)
            .fetch_all(&state.pool).await
        } else {
            sqlx::query(&format!(
                "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                 memory_type, modality, source_mime, namespace, confidence, updated_at, \
                 (embedding <=> $2::vector) AS distance \
                 FROM golden_index \
                 WHERE tenant_id = $1 AND embedding IS NOT NULL {archive_filter} \
                 ORDER BY embedding <=> $2::vector \
                 LIMIT $3",
            ))
            .bind(&tenant_id).bind(&query_vec).bind(limit)
            .fetch_all(&state.pool).await
        };
        match result {
            Ok(rows) if !rows.is_empty() => (Ok(rows), "semantic"),
            Ok(_) => {
                // Fall through to full-text
                let ft = if let Some(ref ns) = req.namespace {
                    sqlx::query(&format!(
                        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                         memory_type, modality, source_mime, namespace, confidence, updated_at, \
                         ts_rank(to_tsvector('english', COALESCE(pointer_summary, '')), plainto_tsquery('english', $2)) AS distance \
                         FROM golden_index WHERE tenant_id = $1 \
                         AND to_tsvector('english', COALESCE(pointer_summary, '')) @@ plainto_tsquery('english', $2) \
                         AND namespace = $3 {archive_filter} \
                         ORDER BY distance DESC, current_heat DESC LIMIT $4",
                    ))
                    .bind(&tenant_id).bind(&req.query).bind(ns).bind(limit)
                    .fetch_all(&state.pool).await
                } else {
                    sqlx::query(&format!(
                        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                         memory_type, modality, source_mime, namespace, confidence, updated_at, \
                         ts_rank(to_tsvector('english', COALESCE(pointer_summary, '')), plainto_tsquery('english', $2)) AS distance \
                         FROM golden_index WHERE tenant_id = $1 \
                         AND to_tsvector('english', COALESCE(pointer_summary, '')) @@ plainto_tsquery('english', $2) \
                         {archive_filter} \
                         ORDER BY distance DESC, current_heat DESC LIMIT $3",
                    ))
                    .bind(&tenant_id).bind(&req.query).bind(limit)
                    .fetch_all(&state.pool).await
                };
                (ft, "full_text_fallback")
            },
            Err(_) => {
                let ft = sqlx::query(&format!(
                    "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                     memory_type, modality, source_mime, namespace, confidence, updated_at, \
                     ts_rank(to_tsvector('english', COALESCE(pointer_summary, '')), plainto_tsquery('english', $2)) AS distance \
                     FROM golden_index WHERE tenant_id = $1 \
                     AND to_tsvector('english', COALESCE(pointer_summary, '')) @@ plainto_tsquery('english', $2) \
                     {archive_filter} \
                     ORDER BY distance DESC, current_heat DESC LIMIT $3",
                ))
                .bind(&tenant_id).bind(&req.query).bind(limit)
                .fetch_all(&state.pool).await;
                (ft, "full_text_semantic_error")
            }
        }
    } else {
        let ft = if let Some(ref ns) = req.namespace {
            sqlx::query(&format!(
                "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                 memory_type, modality, source_mime, namespace, confidence, updated_at, \
                 ts_rank(to_tsvector('english', COALESCE(pointer_summary, '')), plainto_tsquery('english', $2)) AS distance \
                 FROM golden_index WHERE tenant_id = $1 \
                 AND to_tsvector('english', COALESCE(pointer_summary, '')) @@ plainto_tsquery('english', $2) \
                 AND namespace = $3 {archive_filter} \
                 ORDER BY distance DESC, current_heat DESC LIMIT $4",
            ))
            .bind(&tenant_id).bind(&req.query).bind(ns).bind(limit)
            .fetch_all(&state.pool).await
        } else {
            sqlx::query(&format!(
                "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                 memory_type, modality, source_mime, namespace, confidence, updated_at, \
                 ts_rank(to_tsvector('english', COALESCE(pointer_summary, '')), plainto_tsquery('english', $2)) AS distance \
                 FROM golden_index WHERE tenant_id = $1 \
                 AND to_tsvector('english', COALESCE(pointer_summary, '')) @@ plainto_tsquery('english', $2) \
                 {archive_filter} \
                 ORDER BY distance DESC, current_heat DESC LIMIT $3",
            ))
            .bind(&tenant_id).bind(&req.query).bind(limit)
            .fetch_all(&state.pool).await
        };
        (ft, "full_text_no_embedder")
    };

    let rows = match rows {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "recall_test search failed");
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "ok": false, "error": "search_failed" })),
            ).into_response();
        }
    };

    // --- Score and explain ---
    let is_semantic = search_method == "semantic";
    let mut scored: Vec<(f32, serde_json::Value)> = rows
        .iter()
        .filter(|r| { let ns: String = r.get("namespace"); acl.is_allowed(&ns) })
        .map(|r| {
            let id: uuid::Uuid = r.get("id");
            let summary: String = r.get("pointer_summary");
            let heat: f32 = r.get("current_heat");
            let base_utility: f32 = r.get("base_utility");
            let pinned: bool = r.get("is_pinned");
            let mtype: String = r.get("memory_type");
            let modality: String = r.get("modality");
            let ns: String = r.get("namespace");
            let confidence: String = r.get::<Option<String>, _>("confidence").unwrap_or_else(|| "observed".to_string());
            let updated_at: Option<chrono::DateTime<chrono::Utc>> = r.try_get("updated_at").ok();

            let distance: f64 = r.try_get("distance").unwrap_or(0.0);
            let cosine_sim = if is_semantic { (1.0 - distance) as f32 } else { 0.0 };
            let ts_rank = if !is_semantic { distance as f32 } else { 0.0 };

            let eff_sim_w = thermo_config.recall.similarity_weight_for(&mtype);
            let eff_heat_w = thermo_config.recall.heat_weight_for(&mtype);

            let base_score = if is_semantic {
                (cosine_sim * eff_sim_w) + (heat * eff_heat_w)
            } else {
                ts_rank
            };

            let summary_tokens = tokenize(&summary);
            let overlap = query_tokens.intersection(&summary_tokens).count() as f32;
            let overlap_ratio = if query_tokens.is_empty() { 0.0 } else { overlap / query_tokens.len() as f32 };

            // Additive boosts (hot-context search path)
            let temporal_bonus = if let Some(ref window) = temporal_window {
                if let Some(ua) = updated_at {
                    if ua >= window.start && ua <= window.end { temporal_max_boost } else { 0.0 }
                } else { 0.0 }
            } else { 0.0 };
            let temporal_boosted = temporal_bonus > 0.0;

            let ns_boosted = query_namespace.as_deref() == Some(ns.as_str());
            let ns_bonus = if ns_boosted { ns_boost } else { 0.0 };

            let fused_score = base_score
                + (kw_weight * overlap_ratio)
                + temporal_bonus
                + ns_bonus;

            // Staleness: > 30 days
            let stale = updated_at.map(|ua| {
                let age_days = (chrono::Utc::now() - ua).num_days();
                age_days > 30
            }).unwrap_or(false);

            let age_str = updated_at.map(|ua| {
                let diff = chrono::Utc::now().signed_duration_since(ua);
                if diff.num_days() > 365 { format!("{}y ago", diff.num_days() / 365) }
                else if diff.num_days() > 30 { format!("{}mo ago", diff.num_days() / 30) }
                else if diff.num_days() > 0 { format!("{}d ago", diff.num_days()) }
                else if diff.num_hours() > 0 { format!("{}h ago", diff.num_hours()) }
                else { format!("{}m ago", diff.num_minutes()) }
            }).unwrap_or_else(|| "unknown".to_string());

            let explain_obj = if req.explain {
                if is_semantic {
                    serde_json::json!({
                        "search_method": "semantic",
                        "cosine_similarity": cosine_sim,
                        "heat": heat,
                        "similarity_weight": eff_sim_w,
                        "heat_weight": eff_heat_w,
                        "type_aware": true,
                        "base_score": base_score,
                        "keyword_overlap_ratio": overlap_ratio,
                        "keyword_weight": kw_weight,
                        "temporal_boosted": temporal_boosted,
                        "namespace_boosted": ns_boosted,
                        "fused_score": fused_score,
                        "formula": format!(
                            "base=({:.4}*{:.2}+{:.4}*{:.2})[{}], kw=(1+{:.2}*{:.4}){}{}, final={:.4}",
                            cosine_sim, eff_sim_w, heat, eff_heat_w, mtype,
                            kw_weight, overlap_ratio,
                            if temporal_boosted { ", temporal×1.3" } else { "" },
                            if ns_boosted { ", ns_boost" } else { "" },
                            fused_score
                        ),
                    })
                } else {
                    serde_json::json!({
                        "search_method": "full_text",
                        "ts_rank": ts_rank,
                        "heat": heat,
                        "keyword_overlap_ratio": overlap_ratio,
                        "temporal_boosted": temporal_boosted,
                        "namespace_boosted": ns_boosted,
                        "fused_score": fused_score,
                        "note": "cosine_similarity unavailable (FTS path)",
                    })
                }
            } else {
                serde_json::Value::Null
            };

            let mut obj = serde_json::json!({
                "id": id,
                "pointer_summary": summary,
                "current_heat": heat,
                "base_utility": base_utility,
                "is_pinned": pinned,
                "memory_type": mtype,
                "modality": modality,
                "namespace": ns,
                "confidence": confidence,
                "age": age_str,
                "stale": stale,
                "fused_score": fused_score,
            });
            if req.explain {
                obj["explain"] = explain_obj;
            }

            (fused_score, obj)
        })
        .collect();

    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    let vector_results: Vec<serde_json::Value> = scored.iter().map(|(_, v)| v.clone()).collect();

    // --- Entity expansion via AGE graph ---
    let entity_expansion = if crate::graph::graph_available(&state.pool).await {
        let eff_ns = req.namespace.clone().unwrap_or_else(|| tenant_ctx.effective_namespace());
        // Extract entity-like tokens from query (capitalized words as a heuristic)
        let entity_hints: Vec<String> = req.query
            .split_whitespace()
            .filter(|w| w.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) && w.len() > 2)
            .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
            .filter(|w| !w.is_empty())
            .take(5)
            .collect();

        if entity_hints.is_empty() {
            serde_json::json!({ "available": true, "entities": [], "note": "no capitalized entity hints found in query" })
        } else {
            let tenant_escaped = tenant_id.replace('\'', "\\'");
            let ns_escaped = eff_ns.replace('\'', "\\'");
            let mut entities_found: Vec<serde_json::Value> = Vec::new();

            for hint in &entity_hints {
                let name_lower = hint.to_lowercase().replace('\'', "\\'");
                let find_cypher = format!(
                    "MATCH (e:Entity {{tenant_id: '{tenant_escaped}', namespace: '{ns_escaped}'}}) \
                     WHERE e.name CONTAINS '{name_lower}' \
                     RETURN e.name, e.entity_type \
                     LIMIT 3",
                );
                if let Ok(matches) = crate::graph::cypher_query_cols(
                    &state.pool, &find_cypher, &["ename", "etype"],
                ).await {
                    for m in matches {
                        let ename = m.get("ename").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let etype = m.get("etype").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if !ename.is_empty() {
                            entities_found.push(serde_json::json!({
                                "hint": hint,
                                "entity_name": ename,
                                "entity_type": etype,
                            }));
                        }
                    }
                }
            }
            serde_json::json!({
                "available": true,
                "entity_hints": entity_hints,
                "entities": entities_found,
                "note": if entities_found.is_empty() { "no graph matches for capitalized tokens" } else { "graph entities found" },
            })
        }
    } else {
        serde_json::json!({ "available": false, "note": "AGE graph not available" })
    };

    // --- Assemble context XML (mirrors plugin format) ---
    let context_xml = {
        let ns_label = req.namespace.as_deref().unwrap_or("default");
        let mut memory_elements: Vec<String> = Vec::new();
        for item in vector_results.iter().take(8) {
            let mtype = item.get("memory_type").and_then(|v| v.as_str()).unwrap_or("episodic");
            let heat = item.get("current_heat").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let age = item.get("age").and_then(|v| v.as_str()).unwrap_or("unknown");
            let stale = item.get("stale").and_then(|v| v.as_bool()).unwrap_or(false);
            let summary = item.get("pointer_summary").and_then(|v| v.as_str()).unwrap_or("");
            // XML-escape the summary
            let escaped = summary
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            let stale_attr = if stale { r#" stale="true""# } else { "" };
            memory_elements.push(format!(
                r#"  <memory type="{mtype}" heat="{heat:.2}" age="{age}"{stale_attr}>{escaped}</memory>"#
            ));
        }
        let recall_section = if memory_elements.is_empty() {
            String::new()
        } else {
            format!("<recall>\n{}\n</recall>", memory_elements.join("\n"))
        };
        let guidance = "Background context from long-term memory. Use it silently to inform your understanding — only reference it when the conversation naturally calls for it.";
        if recall_section.is_empty() {
            format!(r#"<sulcus_context token_budget="500" namespace="{ns_label}">
  <guidance>No memories matched this query.</guidance>
</sulcus_context>"#)
        } else {
            format!(
                "<sulcus_context token_budget=\"500\" namespace=\"{ns_label}\">\n<guidance>{guidance}</guidance>\n{recall_section}\n</sulcus_context>",
            )
        }
    };

    // Simple token estimate: ~4 chars per token
    let token_estimate = (context_xml.len() as f32 / 4.0).ceil() as u32;

    let temporal_info = temporal_window.as_ref().map(|w| serde_json::json!({
        "reference": w.reference,
        "start": w.start.to_rfc3339(),
        "end": w.end.to_rfc3339(),
    }));

    (axum::http::StatusCode::OK, axum::Json(serde_json::json!({
        "ok": true,
        "query": req.query,
        "namespace": req.namespace,
        "search_method": search_method,
        "result_count": vector_results.len(),
        "pipeline_config": pipeline_config,
        "temporal_window": temporal_info,
        "vector_results": vector_results,
        "entity_expansion": entity_expansion,
        "context_xml": context_xml,
        "token_estimate": token_estimate,
        "token_budget": 500,
        "note": "This endpoint is read-only — no heat boosts or resonance are fired."
    }))).into_response()
}
