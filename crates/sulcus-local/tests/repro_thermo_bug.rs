mod common;
use sulcus_core::StorageBackend;
use uuid::Uuid;

#[tokio::test]
async fn test_ignite_new_node_bug() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;
    let id = Uuid::now_v7();

    // Create a new node (last_accessed_at defaults to NOW())
    storage
        .upsert_node(sulcus_core::graph::Node {
            id,
            label: "New Node".into(),
            pointer_summary: "New Node Content".into(),
            base_utility: 0.0,
            current_heat: 0.0,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: "text".into(),
            source_mime: None,
            namespace: "default".into(),
        })
        .await?;

    // Try to ignite it immediately
    let emb = vec![0.1f32; 384];
    storage.store_node_embedding(id, emb.clone()).await?;

    // ignite should bump heat by ~similarity (which is 1.0 for exact match)
    sulcus_local::thermodynamics::ignite(&storage, &emb, 1).await?;

    let node = storage.get_node(id).await?.unwrap();
    println!("Node heat after ignite: {}", node.current_heat);

    // If bug exists, heat will be 0 (or very close to 0) because of LEAST(age, heat+bump)
    assert!(
        node.current_heat > 0.5,
        "Heat should be bumped to ~1.0, but got {}",
        node.current_heat
    );

    Ok(())
}
