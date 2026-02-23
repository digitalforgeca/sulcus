use axum::body::Body;
use axum::http::Request;
use tower::util::ServiceExt;

use sha2::Digest;
use std::sync::Arc;
use sulcus_server::{make_app_with_state, AppState, SharedState};

#[tokio::test]
async fn metrics_endpoint_returns_counts() -> anyhow::Result<()> {
    // create app state and router
    let state: SharedState = Arc::new(AppState::new());
    let app = make_app_with_state(state.clone());

    // derive tenant id (middleware behavior) and add one node + one op to the tenant-scoped in-memory state
    let mut hasher = sha2::Sha256::new();
    hasher.update("test-key".as_bytes());
    let tenant_id = hex::encode(hasher.finalize());

    {
        let mut golden_map = state.golden.lock().await;
        let tenant_map = golden_map
            .entry(tenant_id.clone())
            .or_insert_with(std::collections::HashMap::new);
        tenant_map.insert(
            uuid::Uuid::from_u128(42),
            sulcus_core::graph::Node {
                id: uuid::Uuid::from_u128(42),
                label: "srv-node".into(),
                pointer_summary: "srv-node".into(),
                base_utility: 0.0,
                current_heat: 1.0,
                is_pinned: false,
                memory_type: "episodic".into(),
            },
        );
    }
    {
        let mut ops_map = state.ops.lock().await;
        let tenant_ops = ops_map.entry(tenant_id.clone()).or_insert_with(Vec::new);
        tenant_ops.push(sulcus_core::sync::MemoryOp {
            op: sulcus_core::sync::OpType::Add,
            payload: None,
            patch: None,
            raw_content: None,
            timestamp: chrono::Utc::now(),
        });
    }

    // Call the metrics handler directly (avoids oneshot/Router state issues).
    // Derive the tenant_id the same way the middleware would from "Bearer test-key".
    use axum::extract::{Extension as AxExt, State as AxState};
    use axum::response::IntoResponse;
    let resp = sulcus_server::agent::metrics(
        AxState(state.clone()),
        AxExt(tenant_id.clone()),
    )
    .await
    .into_response();

    assert_eq!(resp.status(), axum::http::StatusCode::OK);

    let bytes = axum::body::to_bytes(resp.into_body(), 64 * 1024).await?;
    let v: serde_json::Value = serde_json::from_slice(&bytes)?;

    assert_eq!(
        v.get("golden_index_size")
            .and_then(|x| x.as_i64())
            .unwrap_or(0),
        1
    );
    assert_eq!(
        v.get("server_ops_count")
            .and_then(|x| x.as_i64())
            .unwrap_or(0),
        1
    );

    Ok(())
}
