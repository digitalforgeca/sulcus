use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use sqlx::PgPool;
use std::sync::Arc;
use tower::ServiceExt; // for `oneshot`

use sulcus_core::sync::{MemoryOp, OpType};
use sulcus_server::{make_app_with_state, AppState};

async fn setup_test_db(pool: &PgPool) {
    sulcus_server::db::run_migrations(pool).await.unwrap();
    // Clear tables to ensure isolation
    sqlx::query("DELETE FROM server_ops")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM golden_index")
        .execute(pool)
        .await
        .unwrap();

    // Insert two tenants
    sqlx::query("INSERT INTO api_keys (tenant_id, key_hash, plan_tier) VALUES ('tenant_a', encode(sha256('token_a'), 'hex'), 'enterprise') ON CONFLICT DO NOTHING").execute(pool).await.unwrap();
    sqlx::query("INSERT INTO api_keys (tenant_id, key_hash, plan_tier) VALUES ('tenant_b', encode(sha256('token_b'), 'hex'), 'enterprise') ON CONFLICT DO NOTHING").execute(pool).await.unwrap();
}

#[tokio::test]
async fn test_tenant_isolation() {
    // Use explicit URL if set, otherwise bootstrap the integral embedded PG.
    let db_url = if let Ok(url) = std::env::var("SULCUS_DATABASE_URL") {
        url
    } else {
        sulcus::initialize(None)
            .await
            .expect("Failed to initialize embedded PG")
    };

    let connect_opts: sqlx::postgres::PgConnectOptions = db_url.parse().unwrap();
    let connect_opts = connect_opts.statement_cache_capacity(0);

    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_with(connect_opts)
        .await
        .unwrap();
    setup_test_db(&pool).await;

    let state = Arc::new(AppState::new(pool));
    let app = make_app_with_state(state.clone());

    // Tenant A adds a node
    let op_a = MemoryOp {
        op: OpType::Add,
        payload: Some(sulcus_core::graph::Node {
            id: uuid::Uuid::new_v4(),
            label: "Tenant A Node".to_string(),
            pointer_summary: "Summary A".to_string(),
            base_utility: 0.5,
            current_heat: 0.5,
            is_pinned: false,
            memory_type: "episodic".to_string(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        }),
        patch: None,
        raw_content: None,
        vector: None,
        timestamp: chrono::Utc::now(),
    };

    let req_a = Request::builder()
        .method("POST")
        .uri("/api/v1/agent/sync")
        .header("Authorization", "Bearer token_a")
        .header("Content-Type", "application/json")
        .body(Body::from(
            json!({ "ops": [op_a], "last_cursor": null }).to_string(),
        ))
        .unwrap();

    let res_a = app.clone().oneshot(req_a).await.unwrap();
    assert_eq!(res_a.status(), StatusCode::OK);

    // Tenant B fetches its ops, should be empty
    let req_b = Request::builder()
        .method("POST")
        .uri("/api/v1/agent/sync")
        .header("Authorization", "Bearer token_b")
        .header("Content-Type", "application/json")
        .body(Body::from(
            json!({ "ops": [], "last_cursor": null }).to_string(),
        ))
        .unwrap();

    let res_b = app.clone().oneshot(req_b).await.unwrap();
    assert_eq!(res_b.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res_b.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    let new_ops = body_json["new_ops"].as_array().unwrap();
    assert_eq!(new_ops.len(), 0, "Tenant B should not see Tenant A's ops");

    // Tenant A fetches its ops, should see the one it added
    let req_a2 = Request::builder()
        .method("POST")
        .uri("/api/v1/agent/sync")
        .header("Authorization", "Bearer token_a")
        .header("Content-Type", "application/json")
        .body(Body::from(
            json!({ "ops": [], "last_cursor": null }).to_string(),
        ))
        .unwrap();

    let res_a2 = app.clone().oneshot(req_a2).await.unwrap();
    let body_bytes_a2 = axum::body::to_bytes(res_a2.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_json_a2: serde_json::Value = serde_json::from_slice(&body_bytes_a2).unwrap();
    let new_ops_a2 = body_json_a2["new_ops"].as_array().unwrap();
    assert_eq!(new_ops_a2.len(), 1, "Tenant A should see its own ops");
}
