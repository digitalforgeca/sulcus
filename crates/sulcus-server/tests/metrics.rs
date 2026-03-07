use sulcus_server::{make_app_with_state, AppState};

#[tokio::test]
async fn metrics_endpoint_returns_counts() -> anyhow::Result<()> {
    let database_url = match std::env::var("SULCUS_DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("skipping metrics_endpoint_returns_counts: SULCUS_DATABASE_URL not set");
            return Ok(());
        }
    };

    let pool = sqlx::PgPool::connect(&database_url).await?;
    sulcus_server::db::run_migrations(&pool).await?;
    let state = std::sync::Arc::new(AppState::new(pool.clone()));

    // derive tenant id (same way middleware would from "Bearer test-key")
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update("test-key".as_bytes());
    let tenant_id = hex::encode(hasher.finalize());

    // clean slate for this tenant
    sqlx::query("DELETE FROM server_ops WHERE tenant_id = $1")
        .bind(&tenant_id)
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM golden_index WHERE tenant_id = $1")
        .bind(&tenant_id)
        .execute(&pool)
        .await?;

    // seed: add one node via the sync handler (upserts golden_index + server_ops atomically)
    use axum::extract::{Extension as AxExt, Json as AxJson, State as AxState};
    use sulcus_server::agent::{handle_sync, SyncRequest};
    use sulcus_server::middleware::TenantContext;
    let mk_ctx = || TenantContext { id: tenant_id.clone(), plan_tier: "free".to_string(), ops_limit: None, roles: vec![] };

    let node = sulcus_core::graph::Node {
        id: uuid::Uuid::from_u128(9999),
        label: "metrics-node".into(),
        pointer_summary: "metrics-node".into(),
        base_utility: 0.0,
        current_heat: 3.14,
        is_pinned: false,
        memory_type: "episodic".into(),
        modality: sulcus_core::graph::Node::default_modality(),
        source_mime: None,
        namespace: sulcus_core::graph::Node::default_namespace(),
    };
    let op = sulcus_core::sync::MemoryOp {
        op: sulcus_core::sync::OpType::Add,
        payload: Some(node),
        patch: None,
        raw_content: None,
        vector: None, timestamp: chrono::Utc::now(),
    };

    handle_sync(
        AxState(state.clone()),
        AxExt(mk_ctx()),
        AxJson(SyncRequest {
            ops: vec![op],
            last_cursor: None,
        }),
    )
    .await;

    // call metrics handler
    use axum::response::IntoResponse;
    let resp = sulcus_server::agent::metrics(
        AxState(state.clone()),
        AxExt(mk_ctx()),
    )
    .await
    .into_response();

    assert_eq!(resp.status(), axum::http::StatusCode::OK);

    let bytes = axum::body::to_bytes(resp.into_body(), 64 * 1024).await?;
    let v: serde_json::Value = serde_json::from_slice(&bytes)?;

    assert!(
        v.get("golden_index_size")
            .and_then(|x| x.as_i64())
            .unwrap_or(0)
            >= 1,
        "golden_index_size must be >= 1; got: {v}"
    );
    assert!(
        v.get("server_ops_count")
            .and_then(|x| x.as_i64())
            .unwrap_or(0)
            >= 1,
        "server_ops_count must be >= 1; got: {v}"
    );

    Ok(())
}
