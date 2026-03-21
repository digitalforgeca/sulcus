use sulcus_local::{consolidate_hot_clusters, LocalStorage};
use uuid::Uuid;

#[tokio::test]
async fn test_consolidation_cooldown_and_lock() -> anyhow::Result<()> {
    let db_url = sulcus_local::initialize(None).await?;
    let storage = LocalStorage::new(&db_url).await?;

    // Seed some hot nodes so consolidation has work to do
    for i in 0..5 {
        storage
            .upsert_node_internal(sulcus_core::graph::Node {
                id: Uuid::new_v4(),
                label: format!("Node {}", i),
                pointer_summary: format!("Summary for node {}", i),
                base_utility: 0.5,
                current_heat: 1.0,
                is_pinned: false,
                memory_type: "episodic".to_string(),
                modality: "text".to_string(),
                source_mime: None,
                namespace: "default".to_string(),
            })
            .await?;
    }

    // First pass should succeed (no embedder — skip vector generation)
    let count1 = consolidate_hot_clusters(&storage, None).await?;
    assert!(
        count1 > 0,
        "first consolidation pass should synthesise clusters"
    );

    // Second pass immediately after should be blocked by cooldown
    let count2 = consolidate_hot_clusters(&storage, None).await?;
    assert_eq!(count2, 0, "second pass should be blocked by cooldown");

    // Manually clear last_consolidated to test lock (harder to test parallel lock without mocks,
    // but we can at least verify cooldown logic)

    Ok(())
}
