use sulcus_core::StorageBackend;
use sulcus_local::SqliteStorage;

#[tokio::test]
async fn thermodynamics_ignite_context_inserts_heat_and_runs_tick() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    // initialize storage and run migrations
    let storage = SqliteStorage::new(&db_url).await?;
    let pool = storage.pool();
    let sql = include_str!("../migrations/0001_create_tables.sql");
    for stmt in sql.split(';') {
        let s = stmt.trim();
        if s.is_empty() { continue; }
        sqlx::query(s).execute(pool).await?;
    }

    // create nodes A -> B so tick has topology to propagate
    let a = uuid::Uuid::from_u128(0xAAA);
    let b = uuid::Uuid::from_u128(0xBBB);

    storage.upsert_node(sulcus_core::graph::Node {
        id: a,
        label: "A".into(),
        pointer_summary: "A".into(),
        base_utility: 0.0,
        current_heat: 0.0,
        is_pinned: false,
    }).await?;
    storage.upsert_node(sulcus_core::graph::Node {
        id: b,
        label: "B".into(),
        pointer_summary: "B".into(),
        base_utility: 0.0,
        current_heat: 0.0,
        is_pinned: false,
    }).await?;
    storage.insert_edge(a, b, "semantic", 1.0).await?;

    // Insert embeddings into `embeddings` so vector search can find node A as best match
    let emb_a = vec![0.1f32; 384];
    let emb_b = vec![0.9f32; 384];
    let blob_a: Vec<u8> = bytemuck::cast_slice(&emb_a).to_vec();
    let blob_b: Vec<u8> = bytemuck::cast_slice(&emb_b).to_vec();

    sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET vector = excluded.vector")
        .bind(a.to_string())
        .bind(blob_a)
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET vector = excluded.vector")
        .bind(b.to_string())
        .bind(blob_b)
        .execute(pool)
        .await?;

    // Begin a transaction and call ignite_context with the MockEmbeddingProvider
    let mut tx = storage.pool().begin().await?;
    let provider = sulcus_local::MockEmbeddingProvider::new();
    sulcus_local::thermodynamics::ignite_context("any prompt", &provider, &mut tx, &storage).await?;
    tx.commit().await?;

    // After ignite: A should be bumped and tick should have propagated heat to B
    let na = storage.get_node(a).await?.unwrap();
    let nb = storage.get_node(b).await?.unwrap();

    assert!((na.current_heat - 0.8).abs() < 1e-6, "A was ignited");
    assert!(nb.current_heat > 0.0, "B received propagated heat via tick");

    Ok(())
}
