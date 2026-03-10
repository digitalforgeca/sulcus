use sulcus_local::LocalStorage;
use uuid::Uuid;

#[tokio::test]
async fn test_search_vectors_deterministic_and_namespaced() -> anyhow::Result<()> {
    let db_url = if let Ok(url) = std::env::var("SULCUS_DATABASE_URL") {
        url
    } else {
        sulcus_local::initialize(None).await?
    };

    // Ensure we have a clean test environment
    let pool = sqlx::PgPool::connect(&db_url).await?;
    sqlx::query("DELETE FROM nodes").execute(&pool).await?;

    let storage = LocalStorage::from_pool(pool.clone());

    // 1. Insert two nodes with the SAME embedding but different namespaces
    let id1 = Uuid::now_v7();
    let id2 = Uuid::now_v7();
    let emb = vec![0.5f32; 384];

    // Insert first node in 'ns1'
    sqlx::query("INSERT INTO nodes (id, label, pointer_summary, namespace, current_heat) VALUES ($1, 'node1', 'summary1', 'ns1', 1.0)")
        .bind(id1.to_string()).execute(&pool).await?;
    storage.store_node_embedding(id1, emb.clone()).await?;

    // Insert second node in 'ns2'
    sqlx::query("INSERT INTO nodes (id, label, pointer_summary, namespace, current_heat) VALUES ($1, 'node2', 'summary2', 'ns2', 1.0)")
        .bind(id2.to_string()).execute(&pool).await?;
    storage.store_node_embedding(id2, emb.clone()).await?;

    // 2. Search globally (no filters)
    let global_hits = storage.search_vectors(&emb, 10, None, None, None).await;
    assert_eq!(global_hits.len(), 2);
    // Determinism check: id1 < id2 (usually, since id1 was created first with v7)
    assert!(global_hits[0].1 >= global_hits[1].1);
    if (global_hits[0].1 - global_hits[1].1).abs() < 0.0001 {
        // Tie-breaker should be ID asc
        let first_id = global_hits[0].0;
        let second_id = global_hits[1].0;
        assert!(first_id < second_id);
    }

    // 3. Search in 'ns1' only
    let ns1_hits = storage
        .search_vectors(&emb, 10, Some("ns1"), None, None)
        .await;
    assert_eq!(ns1_hits.len(), 1);
    assert_eq!(ns1_hits[0].0, id1);

    // 4. Search in 'ns2' only
    let ns2_hits = storage
        .search_vectors(&emb, 10, Some("ns2"), None, None)
        .await;
    assert_eq!(ns2_hits.len(), 1);
    assert_eq!(ns2_hits[0].0, id2);

    // 5. Search in non-existent 'ns3'
    let ns3_hits = storage
        .search_vectors(&emb, 10, Some("ns3"), None, None)
        .await;
    assert_eq!(ns3_hits.len(), 0);

    Ok(())
}
