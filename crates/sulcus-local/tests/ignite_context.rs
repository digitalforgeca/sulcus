mod common;

use sulcus_core::StorageBackend;

#[tokio::test]
async fn thermodynamics_ignite_context_inserts_heat_and_runs_tick() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;

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
        memory_type: "episodic".into(),
        modality: sulcus_core::graph::Node::default_modality(),
        source_mime: None,
        namespace: sulcus_core::graph::Node::default_namespace(),
    }).await?;
    storage.upsert_node(sulcus_core::graph::Node {
        id: b,
        label: "B".into(),
        pointer_summary: "B".into(),
        base_utility: 0.0,
        current_heat: 0.0,
        is_pinned: false,
        memory_type: "episodic".into(),
        modality: sulcus_core::graph::Node::default_modality(),
        source_mime: None,
        namespace: sulcus_core::graph::Node::default_namespace(),
    }).await?;
    storage.insert_edge(a, b, "semantic", 1.0).await?;

    // Insert embeddings into `embeddings` so vector search can find node A as best match
    let emb_a = vec![0.1f32; 384];
    let emb_b = vec![0.9f32; 384];

    storage.store_node_embedding(a, emb_a).await?;
    storage.store_node_embedding(b, emb_b).await?;

    // Begin a transaction and call ignite_context with the MockEmbeddingProvider
    let mut tx = storage.pool().begin().await?;
    let provider = sulcus_local::MockEmbeddingProvider::new();
    sulcus_local::thermodynamics::ignite_context("any prompt", &provider, &mut tx, &storage).await?;
    tx.commit().await?;

    // After ignite + tick: ignite bumps A by 0.8, tick decays by 0.85 → A≈0.68, B≈0.34
    let na = storage.get_node(a).await?.unwrap();
    let nb = storage.get_node(b).await?.unwrap();

    assert!((na.current_heat - 0.68).abs() < 1e-4, "A heat should be ~0.68 after ignite+tick decay (got {})", na.current_heat);
    assert!(nb.current_heat > 0.0, "B received propagated heat via tick");

    Ok(())
}
