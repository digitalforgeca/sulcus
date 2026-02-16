use axum::{extract::Json, extract::State, response::IntoResponse};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sulcus_core::sync::{MemoryOp, OpType};

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

fn compute_op_hash(op: &MemoryOp) -> String {
    let payload_json = op
        .payload
        .as_ref()
        .map(|n| serde_json::to_string(n).unwrap_or_default())
        .unwrap_or_default();
    let input = format!("{:?}|{}", op.op, payload_json);
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

/// Accepts client WAL ops, merges them into the server's Golden Index, appends to the server WAL,
/// and returns server-side ops newer than `last_cursor`.
pub async fn handle_sync(
    State(state): State<SharedState>,
    Json(req): Json<SyncRequest>,
) -> impl IntoResponse {
    // If a Postgres pool is configured, persist to DB and use DB-backed WAL. Otherwise fall back to in-memory.
    if let Some(pool) = state.pg_pool.as_ref() {
        // persist incoming ops and update golden_index in Postgres (operation-based append)
        if !req.ops.is_empty() {
            if let Err(e) = crate::db::persist_ops_and_upsert_golden(pool, &req.ops).await {
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

        match crate::db::fetch_ops_since(pool, since_ts).await {
            Ok(new_ops) => {
                // durable cursor: latest seq_id in server_ops
                let latest_seq: Option<i64> =
                    sqlx::query_scalar("SELECT max(seq_id) FROM server_ops")
                        .fetch_one(pool)
                        .await
                        .ok();

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
        // compute fingerprint and dedupe against in-memory WAL
        let hash = compute_op_hash(&op);
        let mut wal = state.ops.lock().await;
        let duplicate = wal.iter().any(|existing| compute_op_hash(existing) == hash);
        drop(wal);

        if duplicate {
            // skip duplicates
            continue;
        }

        // apply to golden index
        match op.op {
            OpType::Add | OpType::Update => {
                if let Some(node) = op.payload.clone() {
                    let mut g = state.golden.lock().await;
                    g.insert(node.id, node);
                }
            }
            OpType::Delete => {
                if let Some(node) = op.payload.clone() {
                    let mut g = state.golden.lock().await;
                    g.remove(&node.id);
                }
            }
        }

        // append op to server WAL
        let mut wal = state.ops.lock().await;
        wal.push(op);
    }

    // 2) Return ops newer than `last_cursor` (if provided)
    let since_ts: Option<chrono::DateTime<chrono::Utc>> = match req.last_cursor {
        Some(ref s) => chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.with_timezone(&chrono::Utc)),
        None => None,
    };

    let wal = state.ops.lock().await;
    let new_ops: Vec<MemoryOp> = wal
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
        new_cursor_seq: Some(wal.len() as i64),
    };
    (axum::http::StatusCode::OK, Json(resp))
}
