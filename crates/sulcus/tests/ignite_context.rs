mod common;

use sulcus_core::StorageBackend;

struct UniqueEmbeddingProvider;
impl sulcus::embeddings::EmbeddingProvider for UniqueEmbeddingProvider {
    fn embed(&self, _text: &str) -> Result<Vec<f32>, anyhow::Error> {
        let mut v = vec![0.0f32; 384];
        v[0] = 1.0;
        Ok(v)
    }
    fn embed_image(&self, _path: &str) -> Result<Vec<f32>, anyhow::Error> {
        let mut v = vec![0.0f32; 512];
        v[0] = 1.0;
        Ok(v)
    }
}

#[tokio::test]
async fn thermodynamics_ignite_context_inserts_heat_and_runs_tick() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;

    // create nodes A -> B so tick has topology to propagate
    let a = uuid::Uuid::new_v4();
    let b = uuid::Uuid::new_v4();

    storage
        .upsert_node(sulcus_core::graph::Node {
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
        })
        .await?;
    storage
        .upsert_node(sulcus_core::graph::Node {
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
        })
        .await?;
    storage.insert_edge(a, b, "semantic", 1.0).await?;

    // Insert embeddings into `embeddings` so vector search can find node A as best match
    // Give A the unique embedding so it gets picked up.
    let mut emb_a = vec![0.0f32; 384];
    emb_a[0] = 1.0;

    let mut emb_b = vec![0.0f32; 384];
    emb_b[1] = 1.0;

    storage.store_node_embedding(a, emb_a).await?;
    storage.store_node_embedding(b, emb_b).await?;

    // Begin a transaction and call ignite_context with the custom provider
    let mut tx = storage.pool().begin().await?;
    let provider = UniqueEmbeddingProvider;
    sulcus::thermodynamics::ignite_context("any prompt", &provider, &mut tx, &storage)
        .await?;
    tx.commit().await?;

    // After ignite + tick: ignite bumps A by 0.8. Since it was just accessed (NOW()), temporal decay is 0.
    // Topological diffusion transfers 0.4 to B.
    let na = storage.get_node(a).await?.unwrap();
    let nb = storage.get_node(b).await?.unwrap();

    assert!(
        (na.current_heat - 0.8).abs() < 1e-4,
        "A heat should be ~0.8 after ignite+tick decay (got {})",
        na.current_heat
    );
    assert!(nb.current_heat > 0.0, "B received propagated heat via tick");

    Ok(())
}
