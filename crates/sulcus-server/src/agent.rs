use axum::{
    extract::{Json, Query, State, Extension},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use sulcus_core::sync::{compute_op_hash, MemoryOp, OpType};

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

/// Accepts client WAL ops, merges them into the server's Golden Index, appends to the server WAL,
/// and returns server-side ops newer than `last_cursor`.
pub async fn handle_sync(
    State(state): State<SharedState>,
    Extension(tenant_id): Extension<String>,
    Json(req): Json<SyncRequest>,
) -> impl IntoResponse {
    // If a Postgres pool is configured, persist to DB and use DB-backed WAL. Otherwise fall back to in-memory.
    if let Some(pool) = state.pg_pool.as_ref() {
        // persist incoming ops and update golden_index in Postgres (operation-based append)
        if !req.ops.is_empty() {
            if let Err(e) = crate::db::persist_ops_and_upsert_golden(pool, &tenant_id, &req.ops).await {
                tracing::error!(error = %e, "failed to persist ops to pg");
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

        // serve ops from DB since cursor
        let since_ts: Option<chrono::DateTime<chrono::Utc>> = match req.last_cursor {
            Some(ref s) => chrono::DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Utc)),
            None => None,
        };

        match crate::db::fetch_ops_since(pool, &tenant_id, since_ts).await {
            Ok(new_ops) => {
                // durable cursor: latest seq_id in server_ops (tenant-scoped)
                let latest_seq: Option<i64> = sqlx::query_scalar("SELECT max(seq_id) FROM server_ops WHERE tenant_id = $1")
                    .bind(&tenant_id)
                    .fetch_one(pool)
                    .await
                    .ok();

                // update Prometheus metrics (if initialized) — tenant-scoped counts
                if let Some(m) = crate::metrics::try_get() {
                    let golden_count: i64 = sqlx::query_scalar("SELECT count(*) FROM golden_index WHERE tenant_id = $1")
                        .bind(&tenant_id)
                        .fetch_one(pool)
                        .await
                        .unwrap_or(0);
                    let ops_count: i64 = sqlx::query_scalar("SELECT count(*) FROM server_ops WHERE tenant_id = $1")
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

                let resp = SyncResponse {
                    new_ops,
                    new_cursor: chrono::Utc::now().to_rfc3339(),
                    new_cursor_seq: latest_seq,
                };
                return (axum::http::StatusCode::OK, Json(resp));
            }
            Err(e) => {
                tracing::error!(error = %e, "failed to fetch ops from pg");
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
    }

    // 1) Merge incoming ops into the Golden Index and append to server WAL (in-memory fallback)
    for op in req.ops.into_iter() {
        // compute fingerprint and dedupe against in-memory WAL (tenant-scoped)
        let hash = compute_op_hash(&op);
        let mut ops_map = state.ops.lock().await;
        let tenant_wal = ops_map.entry(tenant_id.clone()).or_insert_with(Vec::new);
        let duplicate = tenant_wal.iter().any(|existing| compute_op_hash(existing) == hash);
        drop(ops_map);

        if duplicate {
            // skip duplicates
            continue;
        }

        // apply to golden index (tenant-scoped)
        match op.op {
            OpType::Add | OpType::Update => {
                if let Some(node) = op.payload.clone() {
                    let mut golden_map = state.golden.lock().await;
                    let tenant_golden = golden_map.entry(tenant_id.clone()).or_insert_with(std::collections::HashMap::new);
                    tenant_golden.insert(node.id, node);
                }
            }
            OpType::Delete => {
                if let Some(node) = op.payload.clone() {
                    let mut golden_map = state.golden.lock().await;
                    if let Some(tenant_golden) = golden_map.get_mut(&tenant_id) {
                        tenant_golden.remove(&node.id);
                    }
                }
            }
        }

        // append op to server WAL (tenant-scoped)
        let mut ops_map = state.ops.lock().await;
        let tenant_wal = ops_map.entry(tenant_id.clone()).or_insert_with(Vec::new);
        tenant_wal.push(op);
    }

    // 2) Return ops newer than `last_cursor` (if provided)
    let since_ts: Option<chrono::DateTime<chrono::Utc>> = match req.last_cursor {
        Some(ref s) => chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.with_timezone(&chrono::Utc)),
        None => None,
    };

    let ops_map = state.ops.lock().await;
    let tenant_wal = ops_map.get(&tenant_id).cloned().unwrap_or_default();
    let new_ops: Vec<MemoryOp> = tenant_wal
        .iter()
        .cloned()
        .filter(|o| match since_ts {
            Some(ref ts) => o.timestamp > *ts,
            None => true,
        })
        .collect();

    let resp = SyncResponse {
        new_ops,
        new_cursor: chrono::Utc::now().to_rfc3339(),
        new_cursor_seq: Some(tenant_wal.len() as i64),
    };

    // update in-memory Prometheus metrics (if initialized) — tenant-scoped
    if let Some(m) = crate::metrics::try_get() {
        let golden_map = state.golden.lock().await;
        let g_len = golden_map.get(&tenant_id).map(|m| m.len()).unwrap_or(0);
        m.golden_index_size.set(g_len as f64);
        let ops_map = state.ops.lock().await;
        let ops_len = ops_map.get(&tenant_id).map(|v| v.len()).unwrap_or(0);
        m.server_ops_in_wal.set(ops_len as f64);
        m.pg_enabled.set(0.0);
    }

    (axum::http::StatusCode::OK, Json(resp))
}

#[derive(Deserialize)]
pub struct HotNodesQuery {
    pub limit: Option<u32>,
}

/// List hot nodes ordered by `heat DESC` (DB-backed when Postgres is configured).
pub async fn list_hot_nodes(
    State(state): State<crate::SharedState>,
    Extension(tenant_id): Extension<String>,
    Query(params): Query<HotNodesQuery>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20) as i64;

    if let Some(pool) = state.pg_pool.as_ref() {
        match crate::db::fetch_top_hot_nodes(pool, &tenant_id, limit).await {
            Ok(nodes) => (axum::http::StatusCode::OK, Json(nodes)),
            Err(e) => {
                tracing::error!(error = %e, "failed to fetch hot nodes from pg");
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(Vec::<sulcus_core::graph::Node>::new()),
                )
            }
        }
    } else {
        // in-memory fallback — tenant-scoped
        let golden_map = state.golden.lock().await;
        let tenant_map = golden_map.get(&tenant_id);
        let mut v: Vec<_> = match tenant_map {
            Some(m) => m.values().cloned().collect(),
            None => Vec::new(),
        };
        v.sort_by(|a, b| {
            b.current_heat
                .partial_cmp(&a.current_heat)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        v.truncate(limit as usize);
        (axum::http::StatusCode::OK, Json(v))
    }
}
/// Runtime/server metrics (prometheus-friendly JSON)
pub async fn metrics(
    State(state): State<crate::SharedState>,
    Extension(tenant_id): Extension<String>,
) -> impl IntoResponse {
    // golden index size (DB if configured, otherwise in-memory count) - tenant scoped
    let golden_index_size: i64 = if let Some(pool) = state.pg_pool.as_ref() {
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM golden_index WHERE tenant_id = $1")
            .bind(&tenant_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0)
    } else {
        let g = state.golden.lock().await;
        g.get(&tenant_id).map(|m| m.len()).unwrap_or(0) as i64
    };

    // server WAL size - tenant scoped
    let server_ops_count: i64 = if let Some(pool) = state.pg_pool.as_ref() {
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM server_ops WHERE tenant_id = $1")
            .bind(&tenant_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0)
    } else {
        let ops = state.ops.lock().await;
        ops.get(&tenant_id).map(|v| v.len()).unwrap_or(0) as i64
    };

    // DB size (postgres only) - global
    let db_size_bytes: i64 = if let Some(pool) = state.pg_pool.as_ref() {
        sqlx::query_scalar::<_, i64>("SELECT pg_database_size(current_database())")
            .fetch_one(pool)
            .await
            .unwrap_or(0)
    } else {
        0
    };

    // update Prometheus metrics if initialized
    if let Some(m) = crate::metrics::try_get() {
        m.golden_index_size.set(golden_index_size as f64);
        m.server_ops_in_wal.set(server_ops_count as f64);
        m.db_size_bytes.set(db_size_bytes as f64);
        m.pg_enabled
            .set(if state.pg_pool.is_some() { 1.0 } else { 0.0 });
    }

    let metrics = serde_json::json!({
        "golden_index_size": golden_index_size,
        "server_ops_count": server_ops_count,
        "db_size_bytes": db_size_bytes,
        "pg_enabled": state.pg_pool.is_some()
    });

    (axum::http::StatusCode::OK, Json(metrics))
}
