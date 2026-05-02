mod common;

use sqlx::Row;
use sulcus::consolidate_hot_clusters;
use uuid::Uuid;

#[tokio::test]
async fn test_consolidation_loop() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let pool = storage.pool();

    // 1. Setup: Create some hot nodes in a namespace
    let namespace = "test_ns";
    let mut node_ids = Vec::new();

    for i in 0..3 {
        let id = Uuid::now_v7();
        node_ids.push(id.to_string());

        sqlx::query(
            "INSERT INTO nodes (id, label, pointer_summary, current_heat, namespace, memory_type) 
             VALUES ($1, $2, $3, $4, $5, 'episodic')",
        )
        .bind(id.to_string())
        .bind(format!("Node {}", i))
        .bind(format!("Summary for node {}", i))
        .bind(0.8f32) // Hot enough for consolidation
        .bind(namespace)
        .execute(pool)
        .await?;
    }

    // 2. Run consolidation
    let synthesised_count = consolidate_hot_clusters(&storage, None).await?;
    assert_eq!(
        synthesised_count, 1,
        "Should have synthesised one namespace"
    );

    // 3. Verify: Synthesis node exists
    let synthesis_node = sqlx::query("SELECT id, label, pointer_summary, memory_type FROM nodes WHERE memory_type = 'synthesis' AND namespace = $1")
        .bind(namespace)
        .fetch_one(pool)
        .await?;

    let synthesis_id: String = synthesis_node.get("id");
    assert!(synthesis_node.get::<String, _>("label").contains(namespace));

    // 4. Verify: Edges exist from synthesis to members
    let edge_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM edges WHERE source_id = $1 AND relationship_type = 'insight'",
    )
    .bind(&synthesis_id)
    .fetch_one(pool)
    .await?;

    assert_eq!(edge_count.0, 3, "Should have 3 insight edges");

    // 5. Verify: Heat boost was applied to members
    for id in &node_ids {
        let heat: f32 = sqlx::query("SELECT current_heat FROM nodes WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await?
            .get("current_heat");

        // Original was 0.8, boost is 0.05
        assert!(heat > 0.8, "Heat should have been boosted for node {}", id);
    }

    Ok(())
}

#[tokio::test]
async fn test_semantic_consolidation_clustering() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let pool = storage.pool();
    let namespace = "semantic_ns";

    // 1. Setup: Create two pairs of semantically related nodes
    // Pair A: Fruits (approx [1, 0, 0])
    // Pair B: Programming (approx [0, 0, 1])
    let node_data = vec![
        ("Apple", "Fruit about apples", vec![0.9, 0.1, 0.0]),
        ("Banana", "Fruit about bananas", vec![0.95, 0.05, 0.0]),
        ("Rust", "Systems programming", vec![0.0, 0.1, 0.9]),
        ("Go", "Cloud programming", vec![0.05, 0.0, 0.95]),
    ];

    for (label, summary, vec) in node_data {
        let id = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT INTO nodes (id, label, pointer_summary, current_heat, namespace, memory_type) 
             VALUES ($1, $2, $3, 0.9, $4, 'episodic')",
        )
        .bind(&id)
        .bind(label)
        .bind(summary)
        .bind(namespace)
        .execute(pool)
        .await?;

        // Use store_node_embedding to ensure HNSW and embeddings table are updated
        storage
            .store_node_embedding(Uuid::parse_str(&id)?, vec)
            .await?;
    }

    // 2. Run consolidation
    let synthesised_count = consolidate_hot_clusters(&storage, None).await?;

    // Should have synthesised TWO clusters (fruits and programming)
    // even though they share the same namespace.
    assert_eq!(
        synthesised_count, 2,
        "Should have synthesised two separate semantic clusters"
    );

    // 3. Verify: Two synthesis nodes exist
    let synthesis_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM nodes WHERE memory_type = 'synthesis' AND namespace = $1",
    )
    .bind(namespace)
    .fetch_one(pool)
    .await?;

    assert_eq!(synthesis_count.0, 2, "Should have 2 synthesis nodes in DB");

    Ok(())
}

#[tokio::test]
async fn test_consolidation_isolation_penalty() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let pool = storage.pool();

    // Setup: One isolated hot node
    let id = Uuid::now_v7().to_string();
    sqlx::query(
        "INSERT INTO nodes (id, label, pointer_summary, current_heat, namespace, memory_type) 
         VALUES ($1, $2, $3, $4, 'isolated', 'episodic')",
    )
    .bind(&id)
    .bind("Isolated Node")
    .bind("I am alone")
    .bind(0.9f32)
    .execute(pool)
    .await?;

    // Run consolidation
    consolidate_hot_clusters(&storage, None).await?;

    // Verify: heat decayed (95% of 0.9 = 0.855)
    let heat: f32 = sqlx::query("SELECT current_heat FROM nodes WHERE id = $1")
        .bind(&id)
        .fetch_one(pool)
        .await?
        .get("current_heat");

    assert!(heat < 0.9, "Isolated hot node should have suffered penalty");

    Ok(())
}
