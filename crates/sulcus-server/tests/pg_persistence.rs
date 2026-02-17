use std::sync::Arc;
use sulcus_server::AppState;

#[tokio::test]
async fn pg_persistence_roundtrip() -> anyhow::Result<()> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("skipping pg_persistence_roundtrip: DATABASE_URL not set");
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
    let state = Arc::new(AppState::new_with_pool(pool.clone()));

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
    };
    let op = MemoryOp {
        op: OpType::Add,
        payload: Some(node.clone()),
        raw_content: None,
        timestamp: Utc::now(),
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

    // call handler (DB-backed path) twice with same op to validate idempotency
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

    // verify DB state: server_ops should contain the op only once and golden_index contains the node
    let row: (i64,) = sqlx::query_as("SELECT count(*) FROM server_ops")
        .fetch_one(&pool)
        .await?;
    assert_eq!(row.0, 1);

    let g: Option<(uuid::Uuid, String, f32)> =
        sqlx::query_as("SELECT id, pointer_summary, current_heat FROM golden_index WHERE id = $1")
            .bind(node.id)
            .fetch_optional(&pool)
            .await?;

    assert!(g.is_some());

    Ok(())
}

#[tokio::test]
async fn pg_fetch_top_hot_nodes() -> anyhow::Result<()> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("skipping pg_fetch_top_hot_nodes: DATABASE_URL not set");
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

    // clear and insert sample nodes
    sqlx::query("DELETE FROM golden_index")
        .execute(&pool)
        .await?;
    let n1 = uuid::Uuid::from_u128(1);
    let n2 = uuid::Uuid::from_u128(2);
    let n3 = uuid::Uuid::from_u128(3);

    sqlx::query("INSERT INTO golden_index (id, pointer_summary, current_heat) VALUES ($1, $2, $3)")
        .bind(n1)
        .bind("a")
        .bind(0.01f32)
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO golden_index (id, pointer_summary, current_heat) VALUES ($1, $2, $3)")
        .bind(n2)
        .bind("b")
        .bind(0.90f32)
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO golden_index (id, pointer_summary, current_heat) VALUES ($1, $2, $3)")
        .bind(n3)
        .bind("c")
        .bind(0.50f32)
        .execute(&pool)
        .await?;

    let nodes = sulcus_server::db::fetch_top_hot_nodes(&pool, 2).await?;
    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0].pointer_summary, "b");
    assert_eq!(nodes[1].pointer_summary, "c");

    Ok(())
}
