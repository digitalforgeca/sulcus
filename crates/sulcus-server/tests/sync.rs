//! Integration tests for the agent sync handler.
//!
//! These tests require a live PostgreSQL-compatible database (PGlite or real
//! Postgres). Set the SULCUS_DATABASE_URL environment variable before running, or the
//! tests will be skipped gracefully.

async fn make_state() -> Option<(std::sync::Arc<sulcus_server::AppState>, sqlx::PgPool)> {
    let url = match std::env::var("SULCUS_DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("Skipping test: SULCUS_DATABASE_URL not set");
            return None;
        }
    };
    let connect_opts: sqlx::postgres::PgConnectOptions = url.parse().ok()?;
    let connect_opts = connect_opts.statement_cache_capacity(0);

    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_with(connect_opts)
        .await
        .ok()?;
    sulcus_server::db::run_migrations(&pool).await.ok()?;
    let state = std::sync::Arc::new(sulcus_server::AppState::new(pool.clone()));
    Some((state, pool))
}

fn sample_node(seed: u128, label: &str, heat: f32) -> sulcus_core::graph::Node {
    sulcus_core::graph::Node {
        id: uuid::Uuid::from_u128(seed),
        label: label.into(),
        pointer_summary: label.into(),
        base_utility: 0.0,
        current_heat: heat,
        is_pinned: false,
        memory_type: "episodic".into(),
        modality: sulcus_core::graph::Node::default_modality(),
        source_mime: None,
        namespace: sulcus_core::graph::Node::default_namespace(),
    }
}

fn add_op(node: sulcus_core::graph::Node) -> sulcus_core::sync::MemoryOp {
    sulcus_core::sync::MemoryOp {
        op: sulcus_core::sync::OpType::Add,
        payload: Some(node),
        patch: None,
        raw_content: None,
        vector: None, timestamp: chrono::Utc::now(),
    }
}

// ---------------------------------------------------------------------------

#[tokio::test]
async fn server_merges_ops_into_golden_and_returns_them_via_cursor() -> anyhow::Result<()> {
    let (state, pool) = match make_state().await {
        Some(s) => s,
        None => return Ok(()),
    };

    let tenant_id = format!("sync-test-{}", uuid::Uuid::new_v4());

    // clean slate for this tenant
    sqlx::query("DELETE FROM server_ops WHERE tenant_id = $1")
        .bind(&tenant_id)
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM golden_index WHERE tenant_id = $1")
        .bind(&tenant_id)
        .execute(&pool)
        .await?;

    let node = sample_node(0xBEEF, "merged-node", 0.5);
    let op = add_op(node.clone());

    use axum::extract::{Extension as AxExtension, Json as AxJson, State as AxState};
    use sulcus_server::agent::{handle_sync, SyncRequest};
    use sulcus_server::middleware::TenantContext;
    let mk_ctx = || TenantContext { id: tenant_id.clone(), plan_tier: "free".to_string(), ops_limit: None, roles: vec![] };

    // push the op
    let push_resp = handle_sync(
        AxState(state.clone()),
        AxExtension(mk_ctx()),
        AxJson(SyncRequest {
            ops: vec![op.clone()],
            last_cursor: None,
        }),
    )
    .await;
    let push_http = axum::response::IntoResponse::into_response(push_resp);
    assert_eq!(push_http.status(), axum::http::StatusCode::OK);

    // verify golden_index via SQL
    let row: (i64,) =
        sqlx::query_as("SELECT count(*) FROM golden_index WHERE tenant_id = $1 AND id = $2")
            .bind(&tenant_id)
            .bind(node.id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(row.0, 1, "node must appear in golden_index");

    // pull since a timestamp before the op — expect to receive the op back
    let since_ts = (op.timestamp - chrono::Duration::seconds(10)).to_rfc3339();
    let pull_resp = handle_sync(
        AxState(state.clone()),
        AxExtension(mk_ctx()),
        AxJson(SyncRequest {
            ops: vec![],
            last_cursor: Some(since_ts),
        }),
    )
    .await;
    let pull_http = axum::response::IntoResponse::into_response(pull_resp);
    let bytes = axum::body::to_bytes(pull_http.into_body(), 64 * 1024).await?;
    let v: serde_json::Value = serde_json::from_slice(&bytes)?;
    let new_ops = v
        .get("new_ops")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    assert!(!new_ops.is_empty(), "ops since cursor must be non-empty");

    Ok(())
}

// ---------------------------------------------------------------------------

#[tokio::test]
async fn db_dedupe_is_idempotent() -> anyhow::Result<()> {
    let (state, pool) = match make_state().await {
        Some(s) => s,
        None => return Ok(()),
    };

    let tenant_id = format!("dedupe-test-{}", uuid::Uuid::new_v4());

    // clean slate for this tenant
    sqlx::query("DELETE FROM server_ops WHERE tenant_id = $1")
        .bind(&tenant_id)
        .execute(&pool)
        .await?;

    let node = sample_node(0xD00D, "dup-node", 1.0);
    let op = add_op(node.clone());

    use axum::extract::{Extension as AxExtension, Json as AxJson, State as AxState};
    use sulcus_server::agent::{handle_sync, SyncRequest};
    use sulcus_server::middleware::TenantContext;
    let mk_ctx = || TenantContext { id: tenant_id.clone(), plan_tier: "free".to_string(), ops_limit: None, roles: vec![] };

    // push the same op twice
    for _ in 0..2 {
        handle_sync(
            AxState(state.clone()),
            AxExtension(mk_ctx()),
            AxJson(SyncRequest {
                ops: vec![op.clone()],
                last_cursor: None,
            }),
        )
        .await;
    }

    // DB should contain exactly one row for this tenant (idempotent insert)
    let row: (i64,) = sqlx::query_as("SELECT count(*) FROM server_ops WHERE tenant_id = $1")
        .bind(&tenant_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(row.0, 1, "ON CONFLICT DO NOTHING must deduplicate ops");

    Ok(())
}
