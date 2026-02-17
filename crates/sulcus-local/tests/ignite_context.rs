use sulcus_core::StorageBackend;
use sulcus_local::SqliteStorage;

#[tokio::test]
async fn thermodynamics_ignite_context_inserts_heat_and_runs_tick() -> anyhow::Result<()> {
    let tmp = tempfile::NamedTempFile::new()?;
    let path = tmp.path().to_str().unwrap().to_owned();
    let db_url = format!("sqlite://{}", path);

    // initialize storage first so sqlite-vec (if available) is registered before migrations
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

    // Insert embeddings into vec_nodes so vector search can find node A as best match
    let emb_a = vec![0.1f32; 384];
    let emb_b = vec![0.9f32; 384];
    let mut blob_a: Vec<u8> = Vec::with_capacity(emb_a.len() * 4);
    for v in emb_a.iter() { blob_a.extend(&v.to_le_bytes()); }
    let mut blob_b: Vec<u8> = Vec::with_capacity(emb_b.len() * 4);
    for v in emb_b.iter() { blob_b.extend(&v.to_le_bytes()); }

    sqlx::query("INSERT INTO vec_nodes (node_id, embedding) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET embedding = excluded.embedding")
        .bind(a.to_string())
        .bind(blob_a)
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO vec_nodes (node_id, embedding) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET embedding = excluded.embedding")
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
