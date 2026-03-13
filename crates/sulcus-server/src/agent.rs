use axum::{
    extract::{Extension, Json, Query, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use sulcus_core::sync::MemoryOp;

use crate::SharedState;

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

        // Award XP for sync and any Add ops (fire-and-forget).
        {
            let add_count = req
                .ops
                .iter()
                .filter(|o| matches!(o.op, sulcus_core::sync::OpType::Add))
                .count() as i32;
            let pool_clone = pool.clone();
            let tid = tenant_id.clone();
            tokio::spawn(async move {
                let _ = crate::gamification::award_xp(&pool_clone, &tid, "sync", 2).await;
                for _ in 0..add_count {
                    let _ = crate::gamification::award_xp(&pool_clone, &tid, "memory.add", 10).await;
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
}

/// Return top `limit` nodes ordered by `current_heat DESC` from the golden index.
pub async fn list_hot_nodes(
    State(state): State<crate::SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Query(params): Query<HotNodesQuery>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20) as i64;
    let pool = &state.pool;
    let tenant_id = tenant_ctx.id;

    let pull_tenants = crate::db::fetch_team_tenant_ids(pool, &tenant_id)
        .await
        .unwrap_or_else(|_| vec![tenant_id.clone()]);

    match crate::db::fetch_top_hot_nodes(pool, &pull_tenants, limit).await {
        Ok(nodes) => (axum::http::StatusCode::OK, Json(nodes)),
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

pub async fn handle_visualize_graph(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    match crate::db::get_graph_snapshot(&state.pool, &tenant_id).await {
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
    let tenant_id = tenant_ctx.id;

    match crate::db::search_golden_index(&state.pool, &tenant_id, &req.query_vector, limit).await {
        Ok(results) => {
            let out: Vec<SearchResult> = results
                .into_iter()
                .map(|(node, score)| SearchResult { node, score })
                .collect();
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
}

/// Text-based search over the tenant's golden index using ILIKE + pg FTS.
/// SDK-friendly: accepts plain text queries, no vector computation required.
pub async fn handle_text_search(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<TextSearchRequest>,
) -> impl IntoResponse {
    let limit = req.limit.unwrap_or(20).min(100) as i64;
    let tenant_id = tenant_ctx.id;
    let pattern = format!("%{}%", req.query.replace('%', "\\%").replace('_', "\\_"));

    let mut sql = String::from(
        "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
         memory_type, modality, source_mime, namespace, updated_at \
         FROM golden_index WHERE tenant_id = $1 AND pointer_summary ILIKE $2",
    );
    let mut param_idx = 3;

    if req.memory_type.is_some() {
        sql.push_str(&format!(" AND memory_type = ${param_idx}"));
        param_idx += 1;
    }
    if req.namespace.is_some() {
        sql.push_str(&format!(" AND namespace = ${param_idx}"));
    }
    let _ = param_idx; // suppress unused warning

    sql.push_str(" ORDER BY current_heat DESC LIMIT $2");

    // Rebuild with proper param ordering — simpler approach
    let rows = if let (Some(ref mt), Some(ref ns)) = (&req.memory_type, &req.namespace) {
        sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
             memory_type, modality, source_mime, namespace, updated_at \
             FROM golden_index WHERE tenant_id = $1 AND pointer_summary ILIKE $2 \
             AND memory_type = $3 AND namespace = $4 \
             ORDER BY current_heat DESC LIMIT $5",
        )
        .bind(&tenant_id)
        .bind(&pattern)
        .bind(mt)
        .bind(ns)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
    } else if let Some(ref mt) = req.memory_type {
        sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
             memory_type, modality, source_mime, namespace, updated_at \
             FROM golden_index WHERE tenant_id = $1 AND pointer_summary ILIKE $2 \
             AND memory_type = $3 \
             ORDER BY current_heat DESC LIMIT $4",
        )
        .bind(&tenant_id)
        .bind(&pattern)
        .bind(mt)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
    } else if let Some(ref ns) = req.namespace {
        sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
             memory_type, modality, source_mime, namespace, updated_at \
             FROM golden_index WHERE tenant_id = $1 AND pointer_summary ILIKE $2 \
             AND namespace = $3 \
             ORDER BY current_heat DESC LIMIT $4",
        )
        .bind(&tenant_id)
        .bind(&pattern)
        .bind(ns)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
    } else {
        sqlx::query(
            "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
             memory_type, modality, source_mime, namespace, updated_at \
             FROM golden_index WHERE tenant_id = $1 AND pointer_summary ILIKE $2 \
             ORDER BY current_heat DESC LIMIT $3",
        )
        .bind(&tenant_id)
        .bind(&pattern)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
    };

    match rows {
        Ok(rows) => {
            let results: Vec<serde_json::Value> = rows
                .iter()
                .map(|r| {
                    let id: uuid::Uuid = r.get("id");
                    let summary: String = r.get("pointer_summary");
                    let heat: f32 = r.get("current_heat");
                    let base_utility: f32 = r.get("base_utility");
                    let pinned: bool = r.get("is_pinned");
                    let mtype: String = r.get("memory_type");
                    let modality: String = r.get("modality");
                    let ns: String = r.get("namespace");
                    serde_json::json!({
                        "id": id,
                        "pointer_summary": summary,
                        "current_heat": heat,
                        "base_utility": base_utility,
                        "is_pinned": pinned,
                        "memory_type": mtype,
                        "modality": modality,
                        "namespace": ns,
                    })
                })
                .collect();
            (axum::http::StatusCode::OK, Json(results)).into_response()
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
    Query(params): Query<ListMemoriesQuery>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(25).clamp(1, 100);
    let offset = (page - 1) * page_size;

    // Build WHERE clause
    let mut conditions = vec!["tenant_id = $1".to_string()];
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
        "SELECT id::text, pointer_summary, memory_type, current_heat, \
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
// PATCH /api/v1/agent/nodes/:id
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PatchMemory {
    pub label: Option<String>,
    pub memory_type: Option<String>,
    pub is_pinned: Option<bool>,
    pub namespace: Option<String>,
    pub current_heat: Option<f32>,
    pub base_utility: Option<f32>,
}

pub async fn patch_memory(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    axum::extract::Path(node_id): axum::extract::Path<String>,
    Json(patch): Json<PatchMemory>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;

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
            let fetch_result =
                sqlx::query_as::<_, (uuid::Uuid, String, f32, f32, bool, String, String, String)>(
                    "SELECT id, pointer_summary, current_heat, base_utility, is_pinned, \
                 memory_type, modality, namespace \
                 FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid",
                )
                .bind(&tenant_id)
                .bind(&node_id)
                .fetch_optional(&state.pool)
                .await;
            match fetch_result {
                Ok(Some((id, summary, heat, base_utility, pinned, mtype, modality, ns))) => (
                    axum::http::StatusCode::OK,
                    Json(serde_json::json!({
                        "id": id,
                        "pointer_summary": summary,
                        "current_heat": heat,
                        "base_utility": base_utility,
                        "is_pinned": pinned,
                        "memory_type": mtype,
                        "modality": modality,
                        "namespace": ns,
                    })),
                )
                    .into_response(),
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
}

pub async fn create_memory(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(body): Json<CreateMemory>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    let id = uuid::Uuid::now_v7();
    let memory_type = body.memory_type.unwrap_or_else(|| "episodic".to_string());
    let heat = body.heat.unwrap_or(0.8);
    let namespace = body.namespace.unwrap_or_else(|| "default".to_string());

    let res = sqlx::query(
        "INSERT INTO golden_index (tenant_id, id, pointer_summary, memory_type, current_heat, namespace, modality, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'text', now())"
    )
    .bind(&tenant_id)
    .bind(id)
    .bind(&body.label)
    .bind(&memory_type)
    .bind(heat)
    .bind(&namespace)
    .execute(&state.pool)
    .await;

    match res {
        Ok(_) => (
            axum::http::StatusCode::CREATED,
            Json(serde_json::json!({
                "id": id.to_string(),
                "label": body.label,
                "memory_type": memory_type,
                "heat": heat,
                "namespace": namespace,
            })),
        )
            .into_response(),
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

pub async fn delete_memory(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    axum::extract::Path(node_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;

    let res = sqlx::query("DELETE FROM golden_index WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(tenant_id)
        .bind(node_id)
        .execute(&state.pool)
        .await;

    match res {
        Ok(r) if r.rows_affected() > 0 => axum::http::StatusCode::NO_CONTENT.into_response(),
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
}

#[derive(Serialize)]
pub struct BulkDeleteResponse {
    pub deleted: u64,
}

pub async fn bulk_delete_memories(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(req): Json<BulkDeleteRequest>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;

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
        conditions.push(format!("namespace = ${bind_idx}"));
        bind_idx += 1;
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
    };

    (axum::http::StatusCode::OK, Json(stats)).into_response()
}
