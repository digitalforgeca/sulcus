use axum::body::Body;
use axum::http::Request;
use hyper::StatusCode;
use tower::util::ServiceExt;

use chrono::Utc;
use std::collections::HashSet;
use std::sync::Arc;
use sulcus_core::graph::Node;
use sulcus_core::sync::{MemoryOp, OpType};
use sulcus_server::{make_app_with_state, AppState, SharedState};

#[tokio::test]
async fn server_merges_incoming_ops_into_golden_index_and_serves_since_cursor() -> anyhow::Result<()>
{
    // create an isolated in-memory server state and router
    let state: SharedState = Arc::new(AppState::new());
    let app: axum::Router<sulcus_server::SharedState> = make_app_with_state(state.clone());

    // prepare a client op (Add)
    let node = Node {
        id: uuid::Uuid::from_u128(42),
        summary: "srv-node".into(),
        heat: 11.0,
    };
    let op = MemoryOp {
        op: OpType::Add,
        payload: Some(node.clone()),
        timestamp: Utc::now(),
    };
    let body = serde_json::json!({ "ops": [serde_json::to_value(&op)?], "last_cursor": null });

    // call the handler directly (no network) to validate merge + since-cursor behavior
    use axum::extract::Json as AxJson;
    use axum::extract::State as AxState;

    // invoke handler (state + json) directly
    let req_obj = sulcus_server::agent::SyncRequest {
        ops: vec![op.clone()],
        last_cursor: None,
    };
    let handler_ret =
        sulcus_server::agent::handle_sync(AxState(state.clone()), AxJson(req_obj)).await;
    let resp = axum::response::IntoResponse::into_response(handler_ret);
    assert_eq!(resp.status(), axum::http::StatusCode::OK);

    // server state should now contain the node in the Golden Index
    let guard = state.golden.lock().await;
    assert!(guard.contains_key(&node.id));

    // now request ops since a timestamp *before* the op -> expect to receive the op
    let req_obj2 = sulcus_server::agent::SyncRequest {
        ops: vec![],
        last_cursor: Some((op.timestamp - chrono::Duration::seconds(10)).to_rfc3339()),
    };
    let handler_ret2 =
        sulcus_server::agent::handle_sync(AxState(state.clone()), AxJson(req_obj2)).await;
    let resp2 = axum::response::IntoResponse::into_response(handler_ret2);
    let bytes = axum::body::to_bytes(resp2.into_body(), 64 * 1024).await?;
    let v: serde_json::Value = serde_json::from_slice(&bytes)?;
    let new_ops = v
        .get("new_ops")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    assert!(!new_ops.is_empty());

    Ok(())
}

#[tokio::test]
async fn in_memory_dedupe_is_idempotent() -> anyhow::Result<()> {
    let state: SharedState = Arc::new(AppState::new());
    let app: axum::Router<sulcus_server::SharedState> = make_app_with_state(state.clone());

    use axum::extract::Json as AxJson;
    use axum::extract::State as AxState;
    use chrono::Utc;
    use sulcus_core::graph::Node;
    use sulcus_core::sync::{MemoryOp, OpType};

    let node = Node {
        id: uuid::Uuid::from_u128(4242),
        summary: "dup-node".into(),
        heat: 1.0,
    };
    let op = MemoryOp {
        op: OpType::Add,
        payload: Some(node.clone()),
        timestamp: Utc::now(),
    };

    // call handler twice with the same op
    let _ = sulcus_server::agent::handle_sync(
        AxState(state.clone()),
        AxJson(sulcus_server::agent::SyncRequest {
            ops: vec![op.clone()],
            last_cursor: None,
        }),
    )
    .await;
    let _ = sulcus_server::agent::handle_sync(
        AxState(state.clone()),
        AxJson(sulcus_server::agent::SyncRequest {
            ops: vec![op.clone()],
            last_cursor: None,
        }),
    )
    .await;

    // in-memory WAL should contain only one op (deduped)
    let wal = state.ops.lock().await;
    assert_eq!(wal.len(), 1);

    Ok(())
}
