use axum::body::Body;
use axum::http::Request;
use tower::util::ServiceExt;

use std::sync::Arc;
use sulcus_server::{make_app_with_state, AppState, SharedState};

#[tokio::test]
async fn metrics_endpoint_returns_counts() -> anyhow::Result<()> {
    // create app state and router
    let state: SharedState = Arc::new(AppState::new());
    let app = make_app_with_state(state.clone());

    // add one node and one op to the in-memory state
    {
        let mut g = state.golden.lock().await;
        g.insert(
            uuid::Uuid::from_u128(42),
            sulcus_core::graph::Node {
                id: uuid::Uuid::from_u128(42),
                label: "srv-node".into(),
                pointer_summary: "srv-node".into(),
                base_utility: 0.0,
                current_heat: 1.0,
                is_pinned: false,
            },
        );
    }
    {
        let mut ops = state.ops.lock().await;
        ops.push(sulcus_core::sync::MemoryOp {
            op: sulcus_core::sync::OpType::Add,
            payload: None,
            raw_content: None,
            timestamp: chrono::Utc::now(),
        });
    }

    // make request (middleware accepts any non-empty token when SULCUS_API_KEY_HASH is not set)
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/metrics")
        .header("authorization", "Bearer test-key")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), axum::http::StatusCode::OK);

    let bytes = axum::body::to_bytes(resp.into_body(), 64 * 1024).await?;
    let v: serde_json::Value = serde_json::from_slice(&bytes)?;

    assert_eq!(v.get("golden_index_size").and_then(|x| x.as_i64()).unwrap_or(0), 1);
    assert_eq!(v.get("server_ops_count").and_then(|x| x.as_i64()).unwrap_or(0), 1);

    Ok(())
}