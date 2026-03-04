use axum::{
    extract::{Json, Query, State, Extension},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use sulcus_core::sync::{MemoryOp};

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
    Extension(tenant_id): Extension<String>,
    Json(req): Json<SyncRequest>,
) -> impl IntoResponse {
    let t0 = std::time::Instant::now();
    let pool = &state.pool;

    // Persist incoming ops and update golden_index (idempotent upsert).
    if !req.ops.is_empty() {
        if let Err(e) =
            crate::db::persist_ops_and_upsert_golden(pool, &tenant_id, &req.ops).await
        {
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
    }

    // Resolve the client's cursor to a timestamp for the pull query.
    let since_ts: Option<chrono::DateTime<chrono::Utc>> = req
        .last_cursor
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    // Fetch ops that the client hasn't seen yet.
    let (new_ops, latest_seq) =
        match crate::db::fetch_ops_and_cursor(pool, &tenant_id, since_ts).await {
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
        let db_size: i64 =
            sqlx::query_scalar("SELECT pg_database_size(current_database())")
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
        let add_count = req.ops.iter().filter(|o| matches!(o.op, sulcus_core::sync::OpType::Add)).count() as i64;
        let pool_clone = pool.clone();
        let tid = tenant_id.clone();
        tokio::spawn(async move {
            if let Err(e) = crate::db::increment_usage(&pool_clone, &tid, 1, add_count, elapsed_ms).await {
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
    Extension(tenant_id): Extension<String>,
    Query(params): Query<HotNodesQuery>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20) as i64;
    let pool = &state.pool;

    match crate::db::fetch_top_hot_nodes(pool, &tenant_id, limit).await {
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
    Extension(tenant_id): Extension<String>,
) -> impl IntoResponse {
    let pool = &state.pool;

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

    let db_size_bytes: i64 =
        sqlx::query_scalar("SELECT pg_database_size(current_database())")
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
    Extension(tenant_id): Extension<String>,
) -> impl IntoResponse {
    let token = gen_token();
    let token_hash = sha256_hex(&token);
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(24);

    if let Err(e) = crate::db::insert_invitation(&state.pool, &tenant_id, &token_hash, expires_at).await {
        tracing::error!(error = %e, "failed to insert invitation");
        return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response();
    }

    (axum::http::StatusCode::OK, Json(InviteResponse {
        invitation_token: token,
        expires_at,
    })).into_response()
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
        Ok(None) => return (axum::http::StatusCode::UNAUTHORIZED, "Invalid or expired token").into_response(),
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

    (axum::http::StatusCode::OK, Json(JoinResponse {
        api_key: new_key,
        tenant_id,
    })).into_response()
}

pub async fn handle_usage(
    State(state): State<SharedState>,
    Extension(tenant_id): Extension<String>,
) -> impl IntoResponse {
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
    Extension(tenant_id): Extension<String>,
) -> impl IntoResponse {
    match crate::db::get_graph_snapshot(&state.pool, &tenant_id).await {
        Ok(snap) => (axum::http::StatusCode::OK, Json(snap)).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch graph snapshot");
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "DB Error").into_response()
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
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    hex::encode(hasher.finalize())
}
