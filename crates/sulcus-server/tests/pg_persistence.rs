use sulcus_server::AppState;

#[tokio::test]
async fn pg_persistence_roundtrip() -> anyhow::Result<()> {
    let database_url = match std::env::var("SULCUS_DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("skipping pg_persistence_roundtrip: SULCUS_DATABASE_URL not set");
            return Ok(());
        }
    };

    let pool = sqlx::PgPool::connect(&database_url).await?;

    // run migrations (idempotent)
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() {
            continue;
        }
        sqlx::query(s).execute(&pool).await?;
    }

    // build app state backed by Postgres
    let state = std::sync::Arc::new(AppState::new(pool.clone()));

    // create an op and call handler directly
    use axum::extract::Json as AxJson;
    use axum::extract::State as AxState;
    use chrono::Utc;
    use sulcus_core::graph::Node;
    use sulcus_core::sync::{MemoryOp, OpType};

    let node = Node {
        id: uuid::Uuid::from_u128(1111),
        label: "pg-node".into(),
        pointer_summary: "pg-node".into(),
        base_utility: 0.0,
        current_heat: 9.0,
        is_pinned: false,
        memory_type: "episodic".into(),
    };
    let op = MemoryOp {
        op: OpType::Add,
        payload: Some(node.clone()),
        patch: None,
        raw_content: None,
        vector: None, timestamp: Utc::now(),
    };
    let req = sulcus_server::agent::SyncRequest {
        ops: vec![op.clone()],
        last_cursor: None,
    };

    // clear tables (idempotent start)
    sqlx::query("DELETE FROM server_ops").execute(&pool).await?;
    sqlx::query("DELETE FROM golden_index")
        .execute(&pool)
        .await?;

    // tenant_id used for this test (middleware normally computes SHA256 hex of token)
    let tenant_id = "pg-test-tenant".to_string();

    // call handler (DB-backed path) twice with same op to validate idempotency
    use axum::extract::Extension as AxExtension;
    use sulcus_server::middleware::TenantContext;
    let mk_ctx = || TenantContext { id: tenant_id.clone(), plan_tier: "free".to_string(), ops_limit: None, roles: vec![] };
    let _ = sulcus_server::agent::handle_sync(
        AxState(state.clone()),
        AxExtension(mk_ctx()),
        AxJson(sulcus_server::agent::SyncRequest {
            ops: vec![op.clone()],
            last_cursor: None,
        }),
    )
    .await;
    let _ = sulcus_server::agent::handle_sync(
        AxState(state.clone()),
        AxExtension(mk_ctx()),
        AxJson(sulcus_server::agent::SyncRequest {
            ops: vec![op.clone()],
            last_cursor: None,
        }),
    )
    .await;

    // verify DB state: server_ops should contain the op only once and golden_index contains the node
    let row: (i64,) = sqlx::query_as("SELECT count(*) FROM server_ops WHERE tenant_id = $1")
        .bind(&tenant_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(row.0, 1);

    let g: Option<(uuid::Uuid, String, f32)> = sqlx::query_as(
        "SELECT id, pointer_summary, current_heat FROM golden_index WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&tenant_id)
    .bind(node.id)
    .fetch_optional(&pool)
    .await?;

    assert!(g.is_some());

    Ok(())
}

#[tokio::test]
async fn pg_fetch_top_hot_nodes() -> anyhow::Result<()> {
    let database_url = match std::env::var("SULCUS_DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("skipping pg_fetch_top_hot_nodes: SULCUS_DATABASE_URL not set");
            return Ok(());
        }
    };

    let pool = sqlx::PgPool::connect(&database_url).await?;

    // run migrations (idempotent)
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() {
            continue;
        }
        sqlx::query(s).execute(&pool).await?;
    }

    // clear and insert sample nodes (tenant-scoped)
    let tenant_id = "pg-test-tenant".to_string();
    sqlx::query("DELETE FROM golden_index")
        .execute(&pool)
        .await?;
    let n1 = uuid::Uuid::from_u128(1);
    let n2 = uuid::Uuid::from_u128(2);
    let n3 = uuid::Uuid::from_u128(3);

    sqlx::query("INSERT INTO golden_index (tenant_id, id, pointer_summary, current_heat) VALUES ($1, $2, $3, $4)")
        .bind(&tenant_id)
        .bind(n1)
        .bind("a")
        .bind(0.01f32)
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO golden_index (tenant_id, id, pointer_summary, current_heat) VALUES ($1, $2, $3, $4)")
        .bind(&tenant_id)
        .bind(n2)
        .bind("b")
        .bind(0.90f32)
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO golden_index (tenant_id, id, pointer_summary, current_heat) VALUES ($1, $2, $3, $4)")
        .bind(&tenant_id)
        .bind(n3)
        .bind("c")
        .bind(0.50f32)
        .execute(&pool)
        .await?;

    let nodes = sulcus_server::db::fetch_top_hot_nodes(&pool, &tenant_id, 2).await?;
    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0].pointer_summary, "b");
    assert_eq!(nodes[1].pointer_summary, "c");

    Ok(())
}

#[tokio::test]
async fn pg_tenant_isolation() -> anyhow::Result<()> {
    let database_url = match std::env::var("SULCUS_DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("skipping pg_tenant_isolation: SULCUS_DATABASE_URL not set");
            return Ok(());
        }
    };

    let pool = sqlx::PgPool::connect(&database_url).await?;

    // run migrations (idempotent)
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() {
            continue;
        }
        sqlx::query(s).execute(&pool).await?;
    }

    // clear tables
    sqlx::query("DELETE FROM server_ops").execute(&pool).await?;
    sqlx::query("DELETE FROM golden_index")
        .execute(&pool)
        .await?;

    // prepare two tenants and ops
    let tenant_a = "tenant-a".to_string();
    let tenant_b = "tenant-b".to_string();

    use sulcus_core::graph::Node;
    use sulcus_core::sync::MemoryOp;
    use sulcus_core::sync::OpType;

    let node_a = Node {
        id: uuid::Uuid::from_u128(0xAAA),
        label: "a".into(),
        pointer_summary: "a".into(),
        base_utility: 0.0,
        current_heat: 0.1,
        is_pinned: false,
        memory_type: "episodic".into(),
    };
    let node_b = Node {
        id: uuid::Uuid::from_u128(0xBBB),
        label: "b".into(),
        pointer_summary: "b".into(),
        base_utility: 0.0,
        current_heat: 0.2,
        is_pinned: false,
        memory_type: "episodic".into(),
    };

    let op_a = MemoryOp {
        op: OpType::Add,
        payload: Some(node_a.clone()),
        patch: None,
        raw_content: None,
        vector: None, timestamp: chrono::Utc::now(),
    };
    let op_b = MemoryOp {
        op: OpType::Add,
        payload: Some(node_b.clone()),
        patch: None,
        raw_content: None,
        vector: None, timestamp: chrono::Utc::now(),
    };

    // persist ops under different tenants
    sulcus_server::db::persist_ops_and_upsert_golden(&pool, &tenant_a, &[op_a]).await?;
    sulcus_server::db::persist_ops_and_upsert_golden(&pool, &tenant_b, &[op_b]).await?;

    // fetch ops for tenant_a -> should only see tenant_a's op
    let since: Option<chrono::DateTime<chrono::Utc>> = None;
    let ops_a = sulcus_server::db::fetch_ops_since(&pool, &tenant_a, since).await?;
    assert!(ops_a
        .iter()
        .any(|o| o.payload.as_ref().map(|n| n.id) == Some(node_a.id)));
    assert!(!ops_a
        .iter()
        .any(|o| o.payload.as_ref().map(|n| n.id) == Some(node_b.id)));

    // fetch top hot nodes for tenant_b -> should only contain node_b
    let hot_b = sulcus_server::db::fetch_top_hot_nodes(&pool, &tenant_b, 10).await?;
    assert!(hot_b.iter().any(|n| n.id == node_b.id));
    assert!(!hot_b.iter().any(|n| n.id == node_a.id));

    Ok(())
}
